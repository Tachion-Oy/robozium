import { describe, expect, it } from "vitest"
import { RunHudPhase } from "../../../../lib/robozium/session/reducer"
import {
	resolveHudPresentation,
	selectHudScreen,
} from "../../../../app/components/hud/hudPresentation"

describe("HUD presentation", () => {
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
		const selected = selectHudScreen("run", "active-run", "dependencies")
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
		expect(selectHudScreen(selected, "landing", "run")).toBe(selected)
	})
})
