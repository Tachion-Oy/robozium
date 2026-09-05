import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ProjectRow } from "../../../../../lib/robosprawl/landing"
import type { Project } from "../../../../../lib/robosprawl/wire"

const mocks = vi.hoisted(() => ({
	cancelProject: vi.fn(),
	createRun: vi.fn(),
	deleteProject: vi.fn(),
	listProjects: vi.fn(),
	routerPush: vi.fn(),
	showErrorToast: vi.fn(),
}))

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: mocks.routerPush }),
}))

vi.mock("../../../../../lib/robosprawl/client", () => ({
	cancelProject: mocks.cancelProject,
	createProject: vi.fn(),
	createRun: mocks.createRun,
	deleteProject: mocks.deleteProject,
	listProjects: mocks.listProjects,
}))

vi.mock("../../../../../app/components/feedback/ErrorToast", () => ({
	showErrorToast: mocks.showErrorToast,
}))

vi.mock("../../../../../app/components/hud/projects/ProjectOverviewPanel", () => ({
	ProjectOverviewPanel: ({
		projects,
		isStarting,
		onCancelRun,
		onDeleteProject,
		onProjectClick,
	}: {
		projects: ProjectRow[]
		isStarting: boolean
		onCancelRun: (project: ProjectRow) => void
		onDeleteProject: (project: ProjectRow) => void
		onProjectClick: (project: ProjectRow) => void
	}) => {
		const project = projects[0]
		return (
			<div>
				<span data-testid="status">{project?.status ?? "missing"}</span>
				{projects.map((row) => (
					<span key={row.slug} data-testid={`status-${row.slug}`}>
						{row.status}
					</span>
				))}
				{project ? (
					<>
						<button type="button" onClick={() => onCancelRun(project)}>
							Cancel
						</button>
						<button type="button" onClick={() => onDeleteProject(project)}>
							Delete
						</button>
						<button
							type="button"
							disabled={isStarting}
							onClick={() => onProjectClick(project)}>
							Open
						</button>
					</>
				) : null}
				{projects.length > 1 ? (
					<button
						type="button"
						onClick={() => {
							onProjectClick(projects[0])
							onProjectClick(projects[1])
						}}>
						Open both
					</button>
				) : null}
			</div>
		)
	},
}))

import { ProjectOverview } from "../../../../../app/components/hud/projects/ProjectOverview"

const syncingProject: Project = {
	slug: "alpha",
	status: "syncing",
	run_id: null,
	current_agent_name: null,
	created_at: null,
}

const cancellingProject: Project = {
	...syncingProject,
	status: "cancelling",
}

const runningProject: Project = {
	...syncingProject,
	status: "running",
	run_id: "run-1",
	current_agent_name: "orchestrator",
	created_at: 1,
}

const dormantProject: Project = {
	...syncingProject,
	status: "dormant",
}

const secondRunningProject: Project = {
	...runningProject,
	slug: "beta",
	run_id: "run-2",
}

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (reason?: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

beforeEach(() => {
	vi.clearAllMocks()
	mocks.listProjects.mockResolvedValue([syncingProject])
})

afterEach(() => cleanup())

describe("ProjectOverview cancellation", () => {
	it("rolls optimistic state back when cancellation is rejected", async () => {
		mocks.cancelProject.mockResolvedValueOnce({ ok: false })
		render(<ProjectOverview initialProjects={[syncingProject]} />)

		fireEvent.click(screen.getByRole("button", { name: "Cancel" }))

		await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("syncing"))
		expect(mocks.showErrorToast).toHaveBeenCalledWith({
			title: "Cancellation failed",
			message: 'Could not cancel "alpha".',
			detail: "The project is still active. Try again.",
		})
	})

	it("shows request-local cancelling immediately, then uses backend state", async () => {
		const request = deferred<{ ok: boolean }>()
		mocks.cancelProject.mockReturnValueOnce(request.promise)
		render(<ProjectOverview initialProjects={[syncingProject]} />)

		fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
		await waitFor(() =>
			expect(screen.getByTestId("status").textContent).toBe("cancelling"),
		)

		mocks.listProjects.mockResolvedValue([cancellingProject])
		request.resolve({ ok: true })
		await waitFor(() =>
			expect(mocks.listProjects.mock.calls.length).toBeGreaterThanOrEqual(2),
		)
		expect(screen.getByTestId("status").textContent).toBe("cancelling")
	})

	it("fast-polls cancelling backend state and accepts its first dormant sample", async () => {
		let backendProject: Project = runningProject
		mocks.listProjects.mockImplementation(async () => [backendProject])
		mocks.cancelProject.mockResolvedValueOnce({ ok: true })
		render(<ProjectOverview initialProjects={[runningProject]} />)
		await waitFor(() => expect(mocks.listProjects).toHaveBeenCalledTimes(1))

		fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
		backendProject = cancellingProject
		await waitFor(() =>
			expect(screen.getByTestId("status").textContent).toBe("cancelling"),
		)
		await waitFor(() =>
			expect(mocks.listProjects.mock.calls.length).toBeGreaterThanOrEqual(2),
		)

		backendProject = dormantProject
		await waitFor(
			() => expect(screen.getByTestId("status").textContent).toBe("dormant"),
			{ timeout: 1500 },
		)
		expect(screen.getByTestId("status").textContent).not.toBe("syncing")
	})

	it("refuses to open or create from a cancelling row", async () => {
		mocks.listProjects.mockResolvedValue([cancellingProject])
		render(<ProjectOverview initialProjects={[cancellingProject]} />)

		fireEvent.click(screen.getByRole("button", { name: "Open" }))

		expect(mocks.createRun).not.toHaveBeenCalled()
		expect(mocks.routerPush).not.toHaveBeenCalled()
	})
})

describe("ProjectOverview opening", () => {
	it.each(["cancelling", "dormant"] as const)(
		"waits for the initial poll and mounts its fresh %s result",
		async (freshStatus) => {
			const refresh = deferred<Project[]>()
			mocks.listProjects.mockReturnValueOnce(refresh.promise)
			render(<ProjectOverview initialProjects={null} />)

			expect(screen.getByText("Refreshing project status")).not.toBeNull()
			expect(screen.queryByTestId("status")).toBeNull()

			refresh.resolve([{ ...runningProject, status: freshStatus }])
			await waitFor(() =>
				expect(screen.getByTestId("status").textContent).toBe(freshStatus),
			)
		},
	)

	it("accepts only the first of two project opens in the same event", async () => {
		mocks.listProjects.mockResolvedValue([runningProject, secondRunningProject])
		render(
			<ProjectOverview initialProjects={[runningProject, secondRunningProject]} />,
		)

		fireEvent.click(screen.getByRole("button", { name: "Open both" }))

		await waitFor(() =>
			expect(screen.getByTestId("status-alpha").textContent).toBe("opening"),
		)
		expect(screen.getByTestId("status-beta").textContent).toBe("running")
		expect(mocks.routerPush).toHaveBeenCalledOnce()
		expect(mocks.routerPush).toHaveBeenCalledWith("/?runId=run-1")
		expect(
			(screen.getByRole("button", { name: "Open" }) as HTMLButtonElement)
				.disabled,
		).toBe(true)
	})

	it("returns to the current run without navigating or marking it opening", async () => {
		const onCurrentProjectClick = vi.fn()
		mocks.listProjects.mockResolvedValue([runningProject])
		render(
			<ProjectOverview
				initialProjects={[runningProject]}
				currentProjectSlug="alpha"
				onCurrentProjectClick={onCurrentProjectClick}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: "Open" }))

		expect(onCurrentProjectClick).toHaveBeenCalledOnce()
		expect(mocks.routerPush).not.toHaveBeenCalled()
		expect(screen.getByTestId("status").textContent).toBe("running")
	})

	it("marks a live row as opening before navigating to its run", async () => {
		mocks.listProjects.mockResolvedValue([runningProject])
		render(<ProjectOverview initialProjects={[runningProject]} />)

		fireEvent.click(screen.getByRole("button", { name: "Open" }))

		await waitFor(() =>
			expect(screen.getByTestId("status").textContent).toBe("opening"),
		)
		expect(mocks.createRun).not.toHaveBeenCalled()
		expect(mocks.routerPush).toHaveBeenCalledWith("/?runId=run-1")
	})

	it("keeps a dormant row opening while its run is created", async () => {
		const request = deferred<{ run_id: string }>()
		mocks.listProjects.mockResolvedValue([dormantProject])
		mocks.createRun.mockReturnValueOnce(request.promise)
		render(<ProjectOverview initialProjects={[dormantProject]} />)

		fireEvent.click(screen.getByRole("button", { name: "Open" }))

		await waitFor(() =>
			expect(screen.getByTestId("status").textContent).toBe("opening"),
		)
		expect(mocks.routerPush).not.toHaveBeenCalled()

		request.resolve({ run_id: "run-2" })
		await waitFor(() =>
			expect(mocks.routerPush).toHaveBeenCalledWith("/?runId=run-2"),
		)
		expect(screen.getByTestId("status").textContent).toBe("opening")
	})

	it("clears opening when dormant run creation fails", async () => {
		mocks.listProjects.mockResolvedValue([dormantProject])
		mocks.createRun.mockRejectedValueOnce(new Error("offline"))
		render(<ProjectOverview initialProjects={[dormantProject]} />)

		fireEvent.click(screen.getByRole("button", { name: "Open" }))

		await waitFor(() =>
			expect(screen.getByTestId("status").textContent).toBe("dormant"),
		)
		expect(mocks.routerPush).toHaveBeenCalledWith(
			"/?error=Unable%20to%20resume%20project",
		)
	})
})

describe("ProjectOverview polling and deletion", () => {
	it("accepts the backend's first dormant sample after a run", async () => {
		mocks.listProjects.mockResolvedValueOnce([dormantProject])
		render(<ProjectOverview initialProjects={[runningProject]} />)

		await waitFor(() => expect(mocks.listProjects).toHaveBeenCalled())
		expect(screen.getByTestId("status").textContent).toBe("dormant")
	})

	it("keeps a successful deletion marked through a stale dormant poll", async () => {
		const request = deferred<{ ok: boolean }>()
		mocks.listProjects.mockResolvedValue([dormantProject])
		mocks.deleteProject.mockReturnValueOnce(request.promise)
		render(<ProjectOverview initialProjects={[dormantProject]} />)
		await waitFor(() => expect(mocks.listProjects).toHaveBeenCalledTimes(1))

		fireEvent.click(screen.getByRole("button", { name: "Delete" }))
		await waitFor(() =>
			expect(screen.getByTestId("status").textContent).toBe("deleting"),
		)

		request.resolve({ ok: true })
		await waitFor(() => expect(mocks.listProjects).toHaveBeenCalledTimes(2))
		expect(screen.getByTestId("status").textContent).toBe("deleting")
	})

	it("restores dormant and reports a failed deletion", async () => {
		mocks.listProjects.mockResolvedValue([dormantProject])
		mocks.deleteProject.mockRejectedValueOnce(new Error("offline"))
		render(<ProjectOverview initialProjects={[dormantProject]} />)

		fireEvent.click(screen.getByRole("button", { name: "Delete" }))

		await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("dormant"))
		expect(mocks.showErrorToast).toHaveBeenCalledWith({
			title: "Deletion failed",
			message: 'Could not delete "alpha".',
			detail: "The project was not deleted. Try again.",
		})
	})
})
