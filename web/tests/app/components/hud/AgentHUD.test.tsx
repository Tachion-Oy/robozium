import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { hudSizeStore } from "../../../../lib/robozium/hud-size"
import { hudVisibilityStore } from "../../../../lib/robozium/hud-visibility"
import { RunHudPhase } from "../../../../lib/robozium/session/reducer"
import type { Project, RunStatus } from "../../../../lib/robozium/wire"

const mocks = vi.hoisted(() => ({
	projectSlug: "alpha" as string | null,
	searchParams: "",
	phase: "streaming" as RunHudPhase,
	status: "running" as RunStatus | null,
	isCancelling: false,
	permanentFailure: false,
}))

vi.mock("next/navigation", () => ({
	useSearchParams: () => new URLSearchParams(mocks.searchParams),
}))
vi.mock("../../../../hooks/useHudEscapeDismiss", () => ({
	useHudEscapeDismiss: () => {},
}))
vi.mock("../../../../hooks/useRunSession", () => ({
	useRunSessionSelector: (
		selector: (state: {
			projectSlug: string | null
				hud: {
					phase: RunHudPhase
					status: RunStatus | null
					isCancelling: boolean
				}
			notifications: Array<{
				category: string
				kind: string
				agentName: string
			}>
		}) => unknown,
		fallback: unknown,
	) =>
		selector({
			projectSlug: mocks.projectSlug,
			hud: {
				phase: mocks.phase,
				status: mocks.status,
				isCancelling: mocks.isCancelling,
			},
			notifications: mocks.permanentFailure
				? [
						{
							category: "stream",
							kind: "open_failed",
							agentName: "system",
						},
					]
				: [],
		}) ?? fallback,
}))
vi.mock("../../../../app/components/hud/HudResizeHandle", () => ({
	ResizableHudBox: ({
		children,
		className,
		inert,
	}: {
		children: ReactNode
		className: string
		inert: boolean
	}) => (
		<div className={className} inert={inert}>
			{children}
			<div data-testid="resize-handle" />
		</div>
	),
}))
vi.mock("../../../../app/components/hud/projects/ProjectOverview", () => ({
	ProjectOverview: ({
		initialProjects,
		currentProjectSlug,
		onCurrentProjectClick,
	}: {
		initialProjects?: Project[] | null
		currentProjectSlug?: string | null
		onCurrentProjectClick?: () => void
	}) => (
		<div>
			Landing HUD content
			<span data-testid="landing-initial-status">
				{initialProjects?.[0]?.status ?? "missing"}
			</span>
			{currentProjectSlug ? <span>Current {currentProjectSlug}</span> : null}
			{onCurrentProjectClick ? (
				<button type="button" onClick={onCurrentProjectClick}>
					Current project
				</button>
			) : null}
		</div>
	),
}))
vi.mock("../../../../app/components/hud/run/RunHud", () => ({
	RunHud: ({
		draft,
		onDraftChange,
	}: {
		draft: string
		onDraftChange: (value: string) => void
	}) => (
		<div>
			Run HUD content
			<textarea
				aria-label="Reply draft"
				value={draft}
				onChange={(event) => onDraftChange(event.target.value)}
			/>
		</div>
	),
}))
vi.mock("../../../../app/components/hud/dependencies/DependencyPanel", () => ({
	DependencyPanel: () => <div>Status panel content</div>,
}))
vi.mock("../../../../app/components/hud/ModelSelector", () => ({
	ModelSelector: ({ runId }: { runId: string | null }) => (
		<button type="button" data-run-id={runId ?? "default"}>
			Model selector
		</button>
	),
	ModelSelectorLoading: () => <button type="button">Loading models</button>,
}))

import { AgentHUD } from "../../../../app/components/hud/AgentHUD"

beforeEach(() => {
	vi.clearAllMocks()
	mocks.projectSlug = "alpha"
	mocks.searchParams = ""
	mocks.phase = RunHudPhase.Streaming
	mocks.status = "running"
	mocks.isCancelling = false
	mocks.permanentFailure = false
	hudSizeStore.setState({ progress: 0 })
	hudVisibilityStore.setState({
		open: true,
		runActive: false,
		prompting: false,
	})
})

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

async function chooseHudScreen(currentLabel: string, nextLabel: string) {
	fireEvent.click(
		screen.getByRole("button", { name: currentLabel }),
	)
	fireEvent.click(
		screen.getByRole("option", { name: nextLabel }),
	)
	await waitFor(() =>
		expect(
			screen.getByRole("button", { name: nextLabel }),
		).not.toBeNull(),
	)
}

describe("AgentHUD status mode", () => {
	it("uses compact landing and wide run defaults on route transitions", () => {
		const view = render(
			<AgentHUD
				runId={null}
				introDone
				modelSelectionPromise={Promise.resolve(null)}
			/>,
		)
		expect(hudSizeStore.getState().progress).toBe(0)

		view.rerender(
			<AgentHUD
				runId="run-1"
				introDone
				modelSelectionPromise={Promise.resolve(null)}
			/>,
		)
		expect(hudSizeStore.getState().progress).toBe(1)

		view.rerender(
			<AgentHUD
				runId={null}
				introDone
				modelSelectionPromise={Promise.resolve(null)}
			/>,
		)
		expect(hudSizeStore.getState().progress).toBe(0)
	})

	it("removes the app-entry marker without another router navigation", () => {
		mocks.searchParams = "from=app"
		const replaceState = vi.spyOn(window.history, "replaceState")

		render(
			<AgentHUD
				runId={null}
				modelSelectionPromise={Promise.resolve(null)}
			/>,
		)

		expect(replaceState).toHaveBeenCalledWith(null, "", "/")
		replaceState.mockRestore()
	})

	it("selects the landing HUD view from the top-right dropdown", async () => {
		render(
			<AgentHUD
				runId={null}
				introDone
				modelSelectionPromise={Promise.resolve(null)}
			/>,
		)

		const viewSelector = screen.getByRole("button", {
			name: "Runs Overview",
		})
		expect(viewSelector.closest(".agent-hud__header")?.className).toBe(
			"agent-hud__header agent-hud__header--landing",
		)
		expect(
			screen
				.getByRole("button", { name: "Model selector" })
				.getAttribute("data-run-id"),
		).toBe("default")
		expect(screen.getByText("Landing HUD content")).not.toBeNull()
		expect(
			(screen.getByRole("button", { name: "Minimize" }) as HTMLButtonElement)
				.disabled,
		).toBe(true)
		expect(
			Array.from(
				document.querySelectorAll<HTMLButtonElement>(
					".agent-hud__layout-controls button",
				),
			).every((button) => button.disabled),
		).toBe(true)
		expect(screen.getByTestId("resize-handle")).not.toBeNull()

		await chooseHudScreen("Runs Overview", "Dependencies")
		expect(screen.queryByText("Landing HUD content")).toBeNull()
		expect(screen.getByText("Status panel content")).not.toBeNull()

		await chooseHudScreen("Dependencies", "Runs Overview")
		expect(screen.getByText("Landing HUD content")).not.toBeNull()
		expect(screen.queryByText("Status panel content")).toBeNull()
	})

	it("offers the same selector during a run and omits it while minimized", () => {
		render(
			<AgentHUD
				runId="run-1"
				introDone
				modelSelectionPromise={Promise.resolve(null)}
			/>,
		)

		const runContent = screen.getByText("Run HUD content")
		expect(runContent.closest(".agent-hud__run-view")).not.toBeNull()
		const modeButton = screen.getByRole("button", {
			name: "Current Run",
		})
		expect(
			screen
				.getByRole("button", { name: "Model selector" })
				.getAttribute("data-run-id"),
		).toBe("run-1")
		expect(modeButton.closest(".agent-hud__header")?.className).toBe(
			"agent-hud__header agent-hud__header--row",
		)
		expect(modeButton.closest(".agent-hud__header")?.querySelector(
			".agent-hud__copy-controls",
		)).toBeNull()
		expect(
			(screen.getByRole("button", { name: "Minimize" }) as HTMLButtonElement)
				.disabled,
		).toBe(false)
		expect(document.querySelector(".agent-hud__corner-controls")).not.toBeNull()
		fireEvent.click(modeButton)
		fireEvent.click(
			screen.getByRole("option", { name: "Dependencies" }),
		)
		expect(screen.getByText("Status panel content")).not.toBeNull()
		expect(
			(screen.getByRole("button", { name: "Minimize" }) as HTMLButtonElement)
				.disabled,
		).toBe(true)
		expect(
			Array.from(
				document.querySelectorAll<HTMLButtonElement>(
					".agent-hud__layout-controls button",
				),
			).every((button) => button.disabled),
		).toBe(true)
		expect(screen.getByTestId("resize-handle")).not.toBeNull()

		act(() => hudVisibilityStore.setState({ open: false }))
		expect(
			screen.queryByRole("button", { name: "Dependencies" }),
		).toBeNull()
		expect(screen.getByRole("button", { name: "Expand" }).textContent).toBe(
			"Expand",
		)

		fireEvent.click(screen.getByRole("button", { name: "Expand" }))
		expect(screen.getByRole("button", { name: "Dependencies" })).not.toBeNull()
		expect(screen.getByText("Status panel content")).not.toBeNull()
	})

	it("opens the agents view and keeps project context", async () => {
		render(
			<AgentHUD
				runId="run-1"
				introDone
				modelSelectionPromise={Promise.resolve(null)}
			/>,
		)

		const projectLabel = document.querySelector(".agent-hud__event-text")
		expect(projectLabel?.textContent).toBe("alpha")
		expect(projectLabel?.getAttribute("title")).toBe("alpha")

		const viewSelector = screen.getByRole("button", { name: "Current Run" })
		expect(viewSelector.className).toContain("agent-hud__view-trigger")
		act(() => hudSizeStore.setState({ progress: 0.45 }))
		fireEvent.click(viewSelector)
		fireEvent.click(
			screen.getByRole("option", { name: "Runs Overview" }),
		)
		expect(hudSizeStore.getState().progress).toBe(0.45)
		expect(screen.queryByText("Run HUD content")).toBeNull()
		expect(screen.getByText("Landing HUD content")).not.toBeNull()
		expect(screen.getByText("Current alpha")).not.toBeNull()
		expect(
			screen
				.getByRole("button", { name: "Model selector" })
				.getAttribute("data-run-id"),
		).toBe("run-1")
		expect(
			(screen.getByRole("button", { name: "Minimize" }) as HTMLButtonElement)
				.disabled,
		).toBe(true)
		expect(document.querySelector(".agent-hud__event-text")?.textContent).toBe(
			"alpha",
		)

		await chooseHudScreen("Runs Overview", "Dependencies")
		expect(screen.getByText("Status panel content")).not.toBeNull()

		await chooseHudScreen("Dependencies", "Runs Overview")
		fireEvent.click(screen.getByRole("button", { name: "Current project" }))
		expect(screen.getByText("Run HUD content")).not.toBeNull()
		expect(hudSizeStore.getState().progress).toBe(0.45)
	})

	it("updates the persistent project label after session hydration", () => {
		mocks.projectSlug = null
		const view = render(
			<AgentHUD
				runId="run-1"
				introDone
				modelSelectionPromise={Promise.resolve(null)}
			/>,
		)
		expect(screen.getByText("waiting for project info")).not.toBeNull()

		mocks.projectSlug = "hydrated-project"
		view.rerender(
			<AgentHUD
				runId="run-1"
				introDone
				modelSelectionPromise={Promise.resolve(null)}
			/>,
		)
		expect(screen.getByText("hydrated-project")).not.toBeNull()
		expect(screen.queryByText("waiting for project info")).toBeNull()
	})

	it("hands a finished run off to a minimizable agents matrix", async () => {
		mocks.phase = RunHudPhase.Done
		render(
			<AgentHUD
				runId="run-1"
				introDone
				modelSelectionPromise={Promise.resolve(null)}
			/>,
		)

		await waitFor(() =>
			expect(screen.getByText("Landing HUD content")).not.toBeNull(),
		)
		expect(hudSizeStore.getState().progress).toBe(0)
		expect(screen.queryByText("Run HUD content")).toBeNull()
		expect(screen.getByRole("button", { name: "Runs Overview" })).not.toBeNull()
		expect(
			screen
				.getByRole("button", { name: "Model selector" })
				.getAttribute("data-run-id"),
		).toBe("default")
		expect(screen.queryByRole("button", { name: "Current project" })).toBeNull()
		expect(screen.queryByText("Current alpha")).toBeNull()
		expect(document.querySelector(".agent-hud__event-text")).toBeNull()
		expect(screen.getByRole("button", { name: "Expand" })).not.toBeNull()
		expect(
			document
				.querySelector(".agent-hud__logo--mini")
				?.hasAttribute("data-agent-state"),
		).toBe(false)
		expect(hudVisibilityStore.getState().runActive).toBe(true)

		act(() => hudVisibilityStore.setState({ open: false }))
		expect(document.querySelector(".agent-hud")?.className).toContain(
			"agent-hud--hidden",
		)
		expect(document.querySelector(".agent-hud__mini")?.className).not.toContain(
			"agent-hud__mini--hidden",
		)
		fireEvent.click(screen.getByRole("button", { name: "Expand" }))
		expect(screen.getByText("Landing HUD content")).not.toBeNull()

		await chooseHudScreen("Runs Overview", "Dependencies")
		expect(screen.getByText("Status panel content")).not.toBeNull()
		await chooseHudScreen("Dependencies", "Runs Overview")
		expect(screen.getByText("Landing HUD content")).not.toBeNull()
	})

	it("uses the same recovery matrix for a permanent run-open failure", async () => {
		mocks.phase = RunHudPhase.Passive
		mocks.permanentFailure = true
		render(
			<AgentHUD
				runId="missing"
				introDone
				modelSelectionPromise={Promise.resolve(null)}
			/>,
		)

		await waitFor(() =>
			expect(screen.getByText("Landing HUD content")).not.toBeNull(),
		)
		expect(hudSizeStore.getState().progress).toBe(0)
		expect(screen.queryByText("Run HUD content")).toBeNull()
		expect(screen.getByRole("button", { name: "Runs Overview" })).not.toBeNull()
		expect(screen.queryByRole("button", { name: "Current project" })).toBeNull()
	})

	it.each([
		["cancelling", false],
		["running", true],
	] as const)(
		"keeps the minimized indicator neutral while status=%s and local cancelling=%s",
		(status, localCancelling) => {
			mocks.phase = RunHudPhase.Passive
			mocks.status = status
			mocks.isCancelling = localCancelling
			render(
				<AgentHUD
					runId="run-1"
					introDone
					modelSelectionPromise={Promise.resolve(null)}
				/>,
			)

			expect(
				document
					.querySelector(".agent-hud__logo--mini")
					?.hasAttribute("data-agent-state"),
			).toBe(false)
		},
	)

	it("returns to the live run HUD when another run is selected", async () => {
		mocks.phase = RunHudPhase.Done
		const view = render(
			<AgentHUD
				runId="run-1"
				introDone
				modelSelectionPromise={Promise.resolve(null)}
			/>,
		)
		await waitFor(() =>
			expect(screen.getByText("Landing HUD content")).not.toBeNull(),
		)
		expect(hudSizeStore.getState().progress).toBe(0)

		mocks.phase = RunHudPhase.Streaming
		view.rerender(
			<AgentHUD
				runId="run-2"
				introDone
				modelSelectionPromise={Promise.resolve(null)}
			/>,
		)

		expect(screen.getByText("Run HUD content")).not.toBeNull()
		expect(screen.queryByText("Landing HUD content")).toBeNull()
		expect(hudSizeStore.getState().progress).toBe(1)
	})
})
