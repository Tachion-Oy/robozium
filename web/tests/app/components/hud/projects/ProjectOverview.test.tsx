import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { Project } from "../../../../../lib/robozium/wire"
import { hudVisibilityStore } from "../../../../../lib/robozium/hud-visibility"
import { ProjectOverview } from "../../../../../app/components/hud/projects/ProjectOverview"

const mocks = vi.hoisted(() => ({
	cancelProject: vi.fn(), deleteProject: vi.fn(), listProjects: vi.fn(),
	push: vi.fn(), showErrorToast: vi.fn(), launch: vi.fn(), select: vi.fn(),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock("../../../../../lib/robozium/client", () => mocks)
vi.mock("../../../../../app/components/feedback/ErrorToast", () => ({ showErrorToast: mocks.showErrorToast }))

const dormant: Project = { slug: "alpha", status: "dormant", run_id: null, created_at: null }
const running: Project = { ...dormant, status: "running", run_id: "run-1" }
const syncing: Project = { ...dormant, status: "syncing" }
function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((done) => { resolve = done })
	return { promise, resolve }
}
function overview(projects: Project[] | null = [dormant], currentRunId: string | null = null, onCurrentProjectClick = vi.fn()) {
	mocks.listProjects.mockResolvedValue(projects ?? [])
	return render(<ProjectOverview initialProjects={projects} currentRunId={currentRunId}
		onCurrentProjectClick={onCurrentProjectClick} onSelectCapabilities={mocks.select} onLaunch={mocks.launch} />)
}
function click(name: string) { fireEvent.click(screen.getByRole("button", { name })) }

beforeEach(() => {
	vi.resetAllMocks()
	hudVisibilityStore.setState({ navigationPending: false })
})
afterEach(cleanup)

it("delegates new and existing selections without launching", () => {
	overview()
	click("New Project")
	expect(mocks.select).toHaveBeenLastCalledWith(null)
	click("Tools")
	expect(mocks.select).toHaveBeenLastCalledWith("alpha")
	click("Open alpha")
	expect(mocks.select).toHaveBeenLastCalledWith("alpha")
	expect(mocks.launch).not.toHaveBeenCalled()
})

it("marks direct launch opening and preserves it through a stale poll", async () => {
	const request = deferred<boolean>()
	mocks.launch.mockReturnValue(request.promise)
	overview()
	click("Launch")
	expect(mocks.launch).toHaveBeenCalledWith({ project: "alpha", name: "alpha", selection: null })
	expect(screen.getByText("OPENING")).not.toBeNull()
	expect((screen.getByRole("button", { name: "Launch" }) as HTMLButtonElement).disabled).toBe(true)
	await waitFor(() => expect(mocks.listProjects).toHaveBeenCalled())
	expect(screen.getByText("OPENING")).not.toBeNull()
	request.resolve(true)
})

it("restores the row after a failed direct launch", async () => {
	mocks.launch.mockResolvedValue(false)
	overview()
	click("Launch")
	await screen.findByText("DORMANT")
	await waitFor(() => expect(mocks.listProjects.mock.calls.length).toBeGreaterThanOrEqual(2))
})

it.each(["cancelling", "syncing", "running"] as const)("disables Tools and Launch for %s projects", (status) => {
	overview([{ ...dormant, status }])
	click("Tools")
	click("Launch")
	expect(mocks.select).not.toHaveBeenCalled()
	expect(mocks.launch).not.toHaveBeenCalled()
})

it("returns to the current run without navigation", () => {
	const returnToRun = vi.fn()
	overview([running], "run-1", returnToRun)
	click("Return to alpha")
	expect(returnToRun).toHaveBeenCalledOnce()
	expect(mocks.push).not.toHaveBeenCalled()
	expect(screen.getByText("RUNNING")).not.toBeNull()
})

it("accepts only the first of two live project opens", () => {
	overview([running, { ...running, slug: "beta", run_id: "run-2" }])
	click("Open alpha")
	click("Open beta")
	expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/?runId=run-1")
	expect(hudVisibilityStore.getState().navigationPending).toBe(true)
})

it.each([false, "network"])("restores optimistic cancellation after rejection: %s", async (failure) => {
	if (failure === false) mocks.cancelProject.mockResolvedValue({ ok: false })
	else mocks.cancelProject.mockRejectedValue(new Error("offline"))
	overview([syncing])
	click("Cancel")
	await waitFor(() => expect(mocks.showErrorToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Cancellation failed" })))
	expect(screen.getByText("SYNCING")).not.toBeNull()
})

it("fast-polls cancellation until the first dormant result", async () => {
	const request = deferred<{ ok: boolean }>()
	mocks.cancelProject.mockReturnValue(request.promise)
	overview([running])
	await waitFor(() => expect(mocks.listProjects).toHaveBeenCalledOnce())
	click("Cancel")
	expect(screen.getByText("CANCELLING")).not.toBeNull()
	mocks.listProjects.mockResolvedValue([{ ...dormant, status: "cancelling" }])
	request.resolve({ ok: true })
	await waitFor(() => expect(mocks.listProjects.mock.calls.length).toBeGreaterThanOrEqual(2))
	mocks.listProjects.mockResolvedValue([dormant])
	await screen.findByText("DORMANT")
})

it.each(["cancelling", "dormant"] as const)("uses the initial poll's fresh %s result", async (status) => {
	const request = deferred<Project[]>()
	mocks.listProjects.mockReturnValue(request.promise)
	render(<ProjectOverview onSelectCapabilities={mocks.select} onLaunch={mocks.launch} />)
	expect(screen.getByText("Refreshing project status")).not.toBeNull()
	request.resolve([{ ...dormant, status }])
	await screen.findByText(status.toUpperCase())
})

it("retains the last table when polling fails", async () => {
	mocks.listProjects.mockRejectedValue(new Error("offline"))
	render(<ProjectOverview initialProjects={[running]} onSelectCapabilities={mocks.select} onLaunch={mocks.launch} />)
	await waitFor(() => expect(mocks.listProjects).toHaveBeenCalled())
	expect(screen.getByText("RUNNING")).not.toBeNull()
})

it("keeps a successful deletion marked through a stale poll", async () => {
	const request = deferred<void>()
	mocks.deleteProject.mockReturnValue(request.promise)
	overview()
	await waitFor(() => expect(mocks.listProjects).toHaveBeenCalledOnce())
	click("Delete")
	click("Confirm?")
	expect(screen.getByText("DELETING")).not.toBeNull()
	request.resolve()
	await waitFor(() => expect(mocks.listProjects).toHaveBeenCalledTimes(2))
	expect(screen.getByText("DELETING")).not.toBeNull()
})

it("restores dormant and reports failed deletion", async () => {
	mocks.deleteProject.mockRejectedValue(new Error("offline"))
	overview()
	click("Delete")
	click("Confirm?")
	await waitFor(() => expect(mocks.showErrorToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Deletion failed" })))
	expect(screen.getByText("DORMANT")).not.toBeNull()
})
