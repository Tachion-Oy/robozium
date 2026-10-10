import { RunHudPhase } from "@/lib/robozium/session/reducer"
import type { HudNavigation, HudScreen } from "@/lib/robozium/hud-navigation"
export type { HudScreen } from "@/lib/robozium/hud-navigation"

export type HudContext = "landing" | "active-run" | "recovery"

export type HudScreenOption = {
	value: HudScreen
	label: string
}

export type HudPresentation = {
	context: HudContext
	screen: HudScreen
	screenOptions: readonly HudScreenOption[]
	modelScope: "default" | "run"
	headerVariant: "landing" | "row"
	showProjectBadge: boolean
	enableCornerControls: boolean
}

const SCREEN_OPTIONS: Record<HudContext, readonly HudScreenOption[]> = {
	landing: [
		{ value: "projects", label: "Runs Overview" },
		{ value: "dependencies", label: "Dependencies" },
		{ value: "environment", label: "Environment" },
	],
	"active-run": [
		{ value: "run", label: "Current Run" },
		{ value: "projects", label: "Runs Overview" },
		{ value: "dependencies", label: "Dependencies" },
		{ value: "environment", label: "Environment" },
	],
	recovery: [
		{ value: "projects", label: "Runs Overview" },
		{ value: "dependencies", label: "Dependencies" },
		{ value: "environment", label: "Environment" },
	],
}

export function resolveHudPresentation({
	hasRun,
	phase,
	runUnavailable,
	selectedScreen,
	launch = null,
}: {
	hasRun: boolean
	phase: RunHudPhase
	runUnavailable: boolean
	selectedScreen: HudScreen
	launch?: HudNavigation["launch"]
}): HudPresentation {
	const context: HudContext = !hasRun
		? "landing"
		: phase === RunHudPhase.Done || runUnavailable
			? "recovery"
			: "active-run"
	const screenOptions: readonly HudScreenOption[] = launch
		? [...SCREEN_OPTIONS[context], { value: "launch", label: "Launch" }]
		: SCREEN_OPTIONS[context]
	const screen = screenOptions.some(({ value }) => value === selectedScreen)
		? selectedScreen
		: "projects"

	return {
		context,
		screen,
		screenOptions,
		modelScope: context === "active-run" && screen !== "launch" ? "run" : "default",
		headerVariant:
			context === "landing" && screen !== "dependencies" && screen !== "environment" ? "landing" : "row",
		showProjectBadge: context === "active-run" && screen !== "launch",
		enableCornerControls: context === "active-run" && screen === "run",
	}
}
