// Copied from robozium-electron/desktop/web/app/components/hud/hudPresentation.ts at 076b2c9.
// Adapted: a run that has ended is passed as runEnded instead of its RunHudPhase.
// Copied from robozium-electron/desktop/web/lib/robozium/hud-navigation.ts at 076b2c9.
export type HudScreen = "projects" | "run" | "dependencies" | "launch" | "environment"

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
	runEnded,
	runUnavailable,
	selectedScreen,
	launch = null,
}: {
	hasRun: boolean
	runEnded: boolean
	runUnavailable: boolean
	selectedScreen: HudScreen
	launch?: object | null
}): HudPresentation {
	const context: HudContext = !hasRun
		? "landing"
		: runEnded || runUnavailable
			? "recovery"
			: "active-run"
	const availableScreens = SCREEN_OPTIONS[context]
	const screenOptions: readonly HudScreenOption[] = launch
		? [...availableScreens, { value: "launch", label: "Launch" }]
		: availableScreens
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
