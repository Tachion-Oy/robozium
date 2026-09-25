import { RunHudPhase } from "@/lib/robozium/session/reducer"

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

export function resolveHudPresentation({
	hasRun,
	phase,
	runUnavailable,
	selectedScreen,
}: {
	hasRun: boolean
	phase: RunHudPhase
	runUnavailable: boolean
	selectedScreen: HudScreen
}): HudPresentation {
	const context: HudContext = !hasRun
		? "landing"
		: phase === RunHudPhase.Done || runUnavailable
			? "recovery"
			: "active-run"
	const screenOptions = SCREEN_OPTIONS[context]
	const screen = screenOptions.some(({ value }) => value === selectedScreen)
		? selectedScreen
		: "projects"

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
	selectedScreen: HudScreen,
	context: HudContext,
	screen: HudScreen,
): HudScreen {
	return SCREEN_OPTIONS[context].some(({ value }) => value === screen)
		? screen
		: selectedScreen
}
