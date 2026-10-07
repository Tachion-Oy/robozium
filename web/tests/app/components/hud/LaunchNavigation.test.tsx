import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { AgentHUD } from "../../../../app/components/hud/AgentHUD"
import { AgentApiError } from "../../../../lib/robozium/client"
import { hudVisibilityStore } from "../../../../lib/robozium/hud-visibility"

const mocks = vi.hoisted(() => ({
	push: vi.fn(), createProject: vi.fn(), createRun: vi.fn(), listCapabilities: vi.fn(),
	listProjects: vi.fn(), listDependencies: vi.fn(), getCredentialStatus: vi.fn(), showErrorToast: vi.fn(),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }), useSearchParams: () => new URLSearchParams() }))
vi.mock("../../../../lib/robozium/client", async (original) => ({
	...await original<typeof import("../../../../lib/robozium/client")>(), ...mocks,
}))
vi.mock("../../../../app/components/feedback/ErrorToast", () => ({ showErrorToast: mocks.showErrorToast }))

beforeEach(() => {
	vi.resetAllMocks()
	hudVisibilityStore.setState({ open: true, navigationPending: false, runActive: false, prompting: false })
	mocks.listProjects.mockResolvedValue([{ slug: "alpha", status: "dormant", run_id: null, created_at: null }])
	mocks.listCapabilities.mockResolvedValue([
		{ name: "filesystem", kind: "skill", selectable: false, loading: "automatic" },
		{ name: "email", kind: "skill", selectable: true, loading: "on_demand" },
	])
	mocks.listDependencies.mockResolvedValue([])
	mocks.getCredentialStatus.mockResolvedValue({ locked: false, encrypted_file_exists: false })
	mocks.createProject.mockResolvedValue({ slug: "new-project" })
	mocks.createRun.mockResolvedValue({ run_id: "new-run" })
})
afterEach(cleanup)

function selectView(name: string) {
	fireEvent.click(document.querySelector<HTMLButtonElement>(".agent-hud__view-trigger")!)
	fireEvent.click(screen.getByRole("option", { name }))
}
async function openNewProject() {
	fireEvent.click(await screen.findByRole("button", { name: "New Project" }))
	fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "  New Project  " } })
	fireEvent.click(await screen.findByRole("checkbox", { name: "email" }))
}
function submit() {
	fireEvent.click(within(screen.getByRole("form")).getByRole("button", { name: "Launch" }))
}

it("retains a launch draft across unmounted screens, then submits only selected choices", async () => {
	render(<AgentHUD runId={null} introDone />)
	await openNewProject()
	const firstForm = screen.getByRole("form")
	selectView("Dependencies")
	expect(firstForm.isConnected).toBe(false)
	selectView("Runs Overview")
	await screen.findByRole("button", { name: "New Project" })
	selectView("Launch")
	expect((screen.getByLabelText("Project name") as HTMLInputElement).value).toBe("  New Project  ")
	expect((await screen.findByRole("checkbox", { name: "email" })).getAttribute("aria-checked")).toBe("true")
	submit()
	await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/?runId=new-run"))
	expect(mocks.createProject).toHaveBeenCalledWith({ name: "New Project" })
	expect(mocks.createRun).toHaveBeenCalledWith({ project: "new-project", capabilities: { email: true } })
	expect(screen.queryByRole("form")).toBeNull()
})

it("cancel and run changes discard drafts", async () => {
	const view = render(<AgentHUD runId={null} introDone />)
	await openNewProject()
	fireEvent.click(within(screen.getByRole("form")).getByRole("button", { name: "Cancel" }))
	fireEvent.click(await screen.findByRole("button", { name: "New Project" }))
	expect((screen.getByLabelText("Project name") as HTMLInputElement).value).toBe("")
	expect((await screen.findByRole("checkbox", { name: "email" })).getAttribute("aria-checked")).toBe("false")
	view.rerender(<AgentHUD runId="another-run" introDone />)
	selectView("Runs Overview")
	fireEvent.click(await screen.findByRole("button", { name: "New Project" }))
	expect((screen.getByLabelText("Project name") as HTMLInputElement).value).toBe("")
})

it.each([423, 409, 503])("reports a %s failure after dismissal and releases navigation", async (status) => {
	let reject!: (reason: unknown) => void
	mocks.createRun.mockReturnValue(new Promise((_, fail) => { reject = fail }))
	render(<AgentHUD runId="existing-run" introDone />)
	selectView("Runs Overview")
	await openNewProject()
	submit()
	await waitFor(() => expect(mocks.createRun).toHaveBeenCalledOnce())
	fireEvent.keyDown(screen.getByRole("button", { name: "Toggle color theme" }), { key: "Escape" })
	expect(screen.queryByRole("form")).toBeNull()
	await act(async () => reject(new AgentApiError(status, "Launch request rejected")))
	expect(mocks.showErrorToast).toHaveBeenCalledWith(expect.objectContaining({
		title: status === 423 ? "API keys locked" : "Launch failed",
		message: status === 423 ? "Unlock API keys before starting a run." : "Launch request rejected",
	}))
	expect(hudVisibilityStore.getState().navigationPending).toBe(false)
	expect(mocks.push).not.toHaveBeenCalled()
	fireEvent.click(screen.getByRole("button", { name: "Expand" }))
	fireEvent.click(await screen.findByRole("button", { name: "New Project" }))
	expect((screen.getByLabelText("Project name") as HTMLInputElement).value).toBe("")
})

it("retains choices for retry and accepts only the first rapid submission", async () => {
	let reject!: (reason: unknown) => void
	mocks.createRun.mockReturnValueOnce(new Promise((_, fail) => { reject = fail }))
	render(<AgentHUD runId={null} introDone />)
	fireEvent.click(await screen.findByRole("button", { name: "Tools" }))
	fireEvent.click(await screen.findByRole("checkbox", { name: "email" }))
	const form = screen.getByRole("form")
	fireEvent.submit(form)
	fireEvent.submit(form)
	expect(mocks.createRun).toHaveBeenCalledOnce()
	await act(async () => reject(new Error("offline")))
	expect(screen.getByRole("checkbox", { name: "email" }).getAttribute("aria-checked")).toBe("true")
	expect(mocks.showErrorToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Launch failed" }))
	submit()
	await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/?runId=new-run"))
	expect(mocks.createRun).toHaveBeenLastCalledWith({ project: "alpha", capabilities: { email: true } })
	expect(mocks.createProject).not.toHaveBeenCalled()
})
