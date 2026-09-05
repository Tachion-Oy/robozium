import { RunHudPhase } from "@/lib/robosprawl/session/reducer"

export type HudScreen = "projects" | "run" | "dependencies"

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

export type HudScreenSelections = Record<HudContext, HudScreen>

const SCREEN_OPTIONS: Record<HudContext, readonly HudScreenOption[]> = {
	landing: [
		{ value: "projects", label: "Runs Overview" },
		{ value: "dependencies", label: "Dependencies" },
	],
	"active-run": [
		{ value: "run", label: "Current Run" },
		{ value: "projects", label: "Runs Overview" },
		{ value: "dependencies", label: "Dependencies" },
	],
	recovery: [
		{ value: "projects", label: "Runs Overview" },
		{ value: "dependencies", label: "Dependencies" },
	],
}

export const DEFAULT_HUD_SCREEN_SELECTIONS: HudScreenSelections = {
	landing: "projects",
	"active-run": "run",
	recovery: "projects",
}

function getHudContext({
	hasRun,
	phase,
	runUnavailable,
}: {
	hasRun: boolean
	phase: RunHudPhase
	runUnavailable: boolean
}): HudContext {
	if (!hasRun) return "landing"
	return phase === RunHudPhase.Done || runUnavailable
		? "recovery"
		: "active-run"
}

export function resolveHudPresentation({
	hasRun,
	phase,
	runUnavailable,
	selections,
}: {
	hasRun: boolean
	phase: RunHudPhase
	runUnavailable: boolean
	selections: HudScreenSelections
}): HudPresentation {
	const context = getHudContext({ hasRun, phase, runUnavailable })
	const screenOptions = SCREEN_OPTIONS[context]
	const requestedScreen = selections[context]
	const screen = screenOptions.some(({ value }) => value === requestedScreen)
		? requestedScreen
		: DEFAULT_HUD_SCREEN_SELECTIONS[context]

	return {
		context,
		screen,
		screenOptions,
		modelScope: context === "active-run" ? "run" : "default",
		headerVariant:
			context === "landing" && screen === "projects" ? "landing" : "row",
		showProjectBadge: context === "active-run",
		enableCornerControls: context === "active-run" && screen === "run",
	}
}

export function selectHudScreen(
	selections: HudScreenSelections,
	context: HudContext,
	screen: HudScreen,
): HudScreenSelections {
	if (!SCREEN_OPTIONS[context].some(({ value }) => value === screen)) {
		return selections
	}
	return { ...selections, [context]: screen }
}
