import { describe, expect, it } from "vitest"
import { RunHudPhase } from "../../../../lib/robozium/session/reducer"
import {
	resolveHudPresentation,
} from "../../../../app/components/hud/hudPresentation"

describe("HUD presentation", () => {
	it("uses the default model for launching another project during an active run", () => {
		const presentation = resolveHudPresentation({
			hasRun: true,
			phase: RunHudPhase.Prompting,
			runUnavailable: false,
			selectedScreen: "launch",
			launch: { project: "another-project", name: "another-project", selection: {} },
		})
		expect(presentation.screen).toBe("launch")
		expect(presentation.modelScope).toBe("default")
		expect(presentation.showProjectBadge).toBe(false)
	})
	it("offers Launch as a distinct screen while retaining Runs Overview", () => {
		const presentation = resolveHudPresentation({
			hasRun: false,
			phase: RunHudPhase.Passive,
			runUnavailable: false,
			selectedScreen: "dependencies",
			launch: { project: null, name: "Draft", selection: {} },
		})
		expect(presentation.screen).toBe("dependencies")
		expect(presentation.screenOptions).toEqual([
			{ value: "projects", label: "Runs Overview" },
			{ value: "dependencies", label: "Dependencies" },
			{ value: "launch", label: "Launch" },
		])
	})
	it.each([
		{
			name: "landing",
			hasRun: false,
			phase: RunHudPhase.Passive,
			runUnavailable: false,
			screen: "projects",
			options: ["projects", "dependencies"],
			modelScope: "default",
			headerVariant: "landing",
		},
		{
			name: "active run",
			hasRun: true,
			phase: RunHudPhase.Streaming,
			runUnavailable: false,
			screen: "run",
			options: ["run", "projects", "dependencies"],
			modelScope: "run",
			headerVariant: "row",
		},
		{
			name: "completed-run recovery",
			hasRun: true,
			phase: RunHudPhase.Done,
			runUnavailable: false,
			screen: "projects",
			options: ["projects", "dependencies"],
			modelScope: "default",
			headerVariant: "row",
		},
		{
			name: "unavailable-run recovery",
			hasRun: true,
			phase: RunHudPhase.Streaming,
			runUnavailable: true,
			screen: "projects",
			options: ["projects", "dependencies"],
			modelScope: "default",
			headerVariant: "row",
		},
	])(
		"resolves $name screen availability and model scope",
		({ options, screen, modelScope, headerVariant, ...input }) => {
			const presentation = resolveHudPresentation({
				...input,
				selectedScreen: input.hasRun ? "run" : "projects",
			})

			expect(presentation.screen).toBe(screen)
			expect(presentation.screenOptions.map(({ value }) => value)).toEqual(options)
			expect(presentation.modelScope).toBe(modelScope)
			expect(presentation.headerVariant).toBe(headerVariant)
		},
	)

	it("preserves the selected panel when a run finishes", () => {
		const selected = "dependencies"
		expect(selected).toBe("dependencies")
		expect(resolveHudPresentation({
			hasRun: true,
			phase: RunHudPhase.Done,
			runUnavailable: false,
			selectedScreen: selected,
		}).screen).toBe("dependencies")
		expect(resolveHudPresentation({
			hasRun: false,
			phase: RunHudPhase.Passive,
			runUnavailable: false,
			selectedScreen: selected,
		}).headerVariant).toBe("row")
	})
})
