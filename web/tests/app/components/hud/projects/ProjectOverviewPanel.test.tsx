import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"

import { ProjectOverviewPanel } from "../../../../../app/components/hud/projects/ProjectOverviewPanel"
import { ProjectStatus, type ProjectRow } from "../../../../../lib/robozium/landing"

function row(overrides: Partial<ProjectRow>): ProjectRow {
	return {
		slug: "alpha",
		status: ProjectStatus.Dormant,
		runId: null,
		agentName: null,
		createdAt: null,
		...overrides,
	}
}

function renderPanel(
	projects: ProjectRow[],
	handlers: Partial<{
		onProjectClick: (p: ProjectRow) => void
		onCancelRun: (p: ProjectRow) => void
		onDeleteProject: (p: ProjectRow) => void
	}> = {},
	currentRunId: string | null = null,
	navigationPending = false,
) {
	return render(
		<ProjectOverviewPanel
			projects={projects}
			currentRunId={currentRunId}
			navigationPending={navigationPending}
			onProjectClick={handlers.onProjectClick ?? (() => {})}
			onCreateRunSubmit={() => {}}
			onCancelRun={handlers.onCancelRun ?? (() => {})}
			onDeleteProject={handlers.onDeleteProject ?? (() => {})}
		/>,
	)
}

function listItemFor(slug: string): HTMLElement {
	const item = screen
		.getAllByRole("listitem")
		.find((li) => li.textContent?.includes(slug))
	if (!item) throw new Error(`no row for ${slug}`)
	return item
}

function actionButtons(li: HTMLElement) {
	return {
		open: within(li).getByRole("button", {
			name: "Open alpha",
		}) as HTMLButtonElement,
		cancel: within(li).getByRole("button", {
			name: "Cancel",
		}) as HTMLButtonElement,
		delete: within(li).getByRole("button", {
			name: "Delete",
		}) as HTMLButtonElement,
	}
}

afterEach(() => cleanup())

describe("ProjectOverviewPanel row actions", () => {
	it("marks only the open run as the current row", () => {
		renderPanel(
			[
				row({ slug: "alpha", status: ProjectStatus.Running, runId: "run-1" }),
				row({ slug: "beta", status: ProjectStatus.Running, runId: "run-2" }),
			],
			{},
			"run-1",
		)

		const current = screen.getByRole("button", { name: "Return to alpha" })
		const other = screen.getByRole("button", { name: "Open beta" })
		expect(current.getAttribute("aria-current")).toBe("true")
		expect(within(current).getByText("alpha").className).toContain(
			"agent-hud__project-name--current",
		)
		expect(other.hasAttribute("aria-current")).toBe(false)
		expect(within(other).getByText("beta").className).not.toContain(
			"agent-hud__project-name--current",
		)
	})

	it("opens a newer run in the same project instead of returning to the old one", () => {
		render(
			<ProjectOverviewPanel
				projects={[row({ status: ProjectStatus.Running, runId: "run-2" })]}
				currentRunId="run-1"
				navigationPending={false}
				onProjectClick={() => {}}
				onCreateRunSubmit={() => {}}
				onCancelRun={() => {}}
				onDeleteProject={() => {}}
			/>,
		)
		expect(screen.getByRole("button", { name: "Open alpha" })).not.toBeNull()
		expect(screen.queryByRole("button", { name: "Return to alpha" })).toBeNull()
	})

	it("does not link a syncing row to the expired run", () => {
		renderPanel(
			[row({ status: ProjectStatus.Syncing, runId: "run-1" })],
			{},
			"run-1",
		)

		expect(
			(screen.getByRole("button", {
				name: "Open alpha",
			}) as HTMLButtonElement).disabled,
		).toBe(true)
	})

	it("enables Cancel and Open but disables Delete on a live run row", () => {
		renderPanel([row({ status: ProjectStatus.Running, runId: "run-1" })])
		const { open, cancel, delete: del } = actionButtons(listItemFor("alpha"))
		expect(open.disabled).toBe(false)
		expect(cancel.disabled).toBe(false)
		expect(del.disabled).toBe(true)
	})

	it("blocks every action while a row is cancelling", () => {
		renderPanel([row({ status: ProjectStatus.Cancelling, runId: "run-1" })])
		const { open, cancel, delete: del } = actionButtons(listItemFor("alpha"))
		expect(open.disabled).toBe(true)
		expect(cancel.disabled).toBe(true)
		expect(del.disabled).toBe(true)
	})

	it("renders opening and blocks every action during navigation", () => {
		renderPanel([row({ status: ProjectStatus.Opening })])
		const li = listItemFor("alpha")
		const status = within(li).getByText("OPENING")
		expect(status.className).toContain("agent-hud__row-status--opening")
		const { open, cancel, delete: del } = actionButtons(li)
		expect(open.disabled).toBe(true)
		expect(cancel.disabled).toBe(true)
		expect(del.disabled).toBe(true)
	})

	it("disables every project open control while one navigation is pending", () => {
		renderPanel(
			[
				row({ slug: "alpha", status: ProjectStatus.Opening }),
				row({ slug: "beta", status: ProjectStatus.Dormant }),
			],
			{},
			null,
			true,
		)

		expect(
			(screen.getByRole("button", { name: "Open alpha" }) as HTMLButtonElement)
				.matches(":disabled"),
		).toBe(true)
		expect(
			(screen.getByRole("button", { name: "Open beta" }) as HTMLButtonElement)
				.matches(":disabled"),
		).toBe(true)
	})

	it("renders deleting and blocks every action until the row disappears", () => {
		renderPanel([row({ status: ProjectStatus.Deleting })])
		const li = listItemFor("alpha")
		expect(within(li).getByText("DELETING")).not.toBeNull()
		const { open, cancel, delete: del } = actionButtons(li)
		expect(open.disabled).toBe(true)
		expect(cancel.disabled).toBe(true)
		expect(del.disabled).toBe(true)
	})

	it("calls onCancelRun when Cancel is clicked", () => {
		const onCancelRun = vi.fn()
		const project = row({ status: ProjectStatus.Running, runId: "run-1" })
		renderPanel([project], { onCancelRun })

		fireEvent.click(actionButtons(listItemFor("alpha")).cancel)
		expect(onCancelRun).toHaveBeenCalledWith(project)
	})

	it("requires a two-step confirm before deleting a dormant project", () => {
		const onDeleteProject = vi.fn()
		const project = row({ status: ProjectStatus.Dormant })
		renderPanel([project], { onDeleteProject })
		const li = listItemFor("alpha")

		// First click only arms the confirm; it must not delete yet.
		fireEvent.click(within(li).getByRole("button", { name: "Delete" }))
		expect(onDeleteProject).not.toHaveBeenCalled()

		// Second click on the confirm button performs the delete.
		fireEvent.click(within(li).getByRole("button", { name: "Confirm?" }))
		expect(onDeleteProject).toHaveBeenCalledWith(project)
	})

	it("keeps a dormant row fully recoverable: open and delete both enabled", () => {
		renderPanel([row({ status: ProjectStatus.Dormant })])
		const { open, cancel, delete: del } = actionButtons(listItemFor("alpha"))
		expect(open.disabled).toBe(false)
		expect(cancel.disabled).toBe(true)
		expect(del.disabled).toBe(false)
	})

	it("blocks open and delete for a live syncing row but keeps cancel available", () => {
		const project = row({ status: ProjectStatus.Syncing, runId: "run-1" })
		renderPanel([project])
		const { open, cancel, delete: del } = actionButtons(listItemFor("alpha"))
		// The librarian owns a live syncing run: opening/deleting is blocked
		// until it settles, but the run itself must still be cancellable.
		expect(open.disabled).toBe(true)
		expect(cancel.disabled).toBe(false)
		expect(del.disabled).toBe(true)
	})

	it("blocks open/delete but keeps cancel for syncing rows without a run id", () => {
		const onProjectClick = vi.fn()
		const onDeleteProject = vi.fn()
		const onCancelRun = vi.fn()
		const project = row({ status: ProjectStatus.Syncing, runId: null })
		renderPanel([project], { onProjectClick, onDeleteProject, onCancelRun })
		const li = listItemFor("alpha")

		expect(within(li).getByText("SYNCING")).not.toBeNull()

		const { open, cancel, delete: del } = actionButtons(li)
		expect(cancel.disabled).toBe(false)
		expect(open.disabled).toBe(true)
		expect(del.disabled).toBe(true)
		fireEvent.click(cancel)
		expect(onCancelRun).toHaveBeenCalledWith(project)
	})

	it("uses different active color schemes for waiting and syncing", () => {
		renderPanel([
			row({ slug: "waiting", status: ProjectStatus.AwaitingUserInput }),
			row({ slug: "syncing", status: ProjectStatus.Syncing }),
		])

		expect(screen.getByText("WAITING").className).toContain("text-term-amber")
		expect(screen.getByText("SYNCING").className).toContain("--term-lime")
		expect(screen.getByText("SYNCING").className).not.toContain(
			"text-term-amber",
		)
	})
})
