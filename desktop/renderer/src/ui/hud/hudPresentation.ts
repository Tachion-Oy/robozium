// A run that has ended is passed as runEnded instead of its RunHudPhase, and
// the project badge shows on Current Run only.
import type { HudScreen } from "../../app/hud-navigation"

export type { HudScreen }

export type HudContext = "landing" | "active-run" | "recovery"

export type HudScreenOption = {
	value: HudScreen
	label: string
	disabled?: boolean
}

export type HudPresentation = {
	context: HudContext
	screen: HudScreen
	screenOptions: readonly HudScreenOption[]
	modelScope: "default" | "run"
	headerVariant: "landing" | "row"
	showProjectBadge: boolean
	enableCornerControls: boolean
	/** No API keys are configured yet, or a change waits for Restart app; runs cannot start. */
	locked: boolean
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

/** Start Here opens onboarding from Runs Overview; the menu only leads to Environment. */
const SETUP_SCREENS: readonly HudScreen[] = ["projects", "onboarding", "environment"]

/** Until Restart app, only Environment stays open: more settings and imports, then the restart. */
const RESTART_SCREENS: readonly HudScreen[] = ["environment"]

function restartScreenOptions(): readonly HudScreenOption[] {
	return SCREEN_OPTIONS.landing.map((option) => ({ ...option, disabled: option.value !== "environment" }))
}

function setupScreenOptions(screen: HudScreen): readonly HudScreenOption[] {
	return SCREEN_OPTIONS.landing.map((option) => ({
		...option,
		disabled: option.value === "dependencies" || (option.value === "projects" && screen !== "environment"),
	}))
}

export function resolveHudPresentation({
	hasRun,
	runEnded,
	runUnavailable,
	selectedScreen,
	launch = null,
	setupRequired = false,
	restartRequired = false,
}: {
	hasRun: boolean
	runEnded: boolean
	runUnavailable: boolean
	selectedScreen: HudScreen
	launch?: object | null
	setupRequired?: boolean
	restartRequired?: boolean
}): HudPresentation {
	const context: HudContext = !hasRun
		? "landing"
		: runEnded || runUnavailable
			? "recovery"
			: "active-run"
	const contextOptions: readonly HudScreenOption[] = launch
		? [...SCREEN_OPTIONS[context], { value: "launch", label: "Launch" }]
		: SCREEN_OPTIONS[context]
	const allowedScreens = restartRequired ? RESTART_SCREENS : setupRequired ? SETUP_SCREENS : contextOptions.map(({ value }) => value)
	const screen = allowedScreens.includes(selectedScreen) ? selectedScreen : restartRequired ? "environment" : "projects"
	const screenOptions = restartRequired ? restartScreenOptions() : setupRequired ? setupScreenOptions(screen) : contextOptions
	const locked = setupRequired || restartRequired

	return {
		context,
		screen,
		screenOptions,
		modelScope: context === "active-run" && screen !== "launch" ? "run" : "default",
		headerVariant:
			context === "landing" && screen !== "dependencies" && screen !== "environment" && screen !== "onboarding" ? "landing" : "row",
		// The project name labels the run on Current Run only; elsewhere it would look like the screen's subject.
		showProjectBadge: context === "active-run" && screen === "run" && !locked,
		enableCornerControls: context === "active-run" && screen === "run" && !locked,
		locked,
	}
}
