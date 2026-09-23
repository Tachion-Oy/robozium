import { describe, expect, it } from "vitest"
import { RunHudPhase } from "../../../../lib/robozium/session/reducer"
import {
	DEFAULT_HUD_SCREEN_SELECTIONS,
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
				selections: DEFAULT_HUD_SCREEN_SELECTIONS,
			})

			expect(presentation.screen).toBe(screen)
			expect(presentation.screenOptions.map(({ value }) => value)).toEqual(options)
			expect(presentation.modelScope).toBe(modelScope)
			expect(presentation.headerVariant).toBe(headerVariant)
		},
	)

	it("keeps independent screen selections for landing, active run, and recovery", () => {
		const selected = selectHudScreen(
			selectHudScreen(DEFAULT_HUD_SCREEN_SELECTIONS, "active-run", "projects"),
			"recovery",
			"dependencies",
		)

		expect(selected).toEqual({
			landing: "projects",
			"active-run": "projects",
			recovery: "dependencies",
		})
		expect(selectHudScreen(selected, "landing", "run")).toBe(selected)
	})
})
