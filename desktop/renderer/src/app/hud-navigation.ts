// The selected screen and the launch draft, changed only by the events below, and the
// screen the HUD shows for them. Selections come from the desktop capability API.
import type { CapabilitySelection } from "../capabilities/capabilities-api"

export type HudScreen = "projects" | "run" | "dependencies" | "launch" | "environment" | "onboarding"

/** A running or waiting run the view menu opens. */
export type HudRun = {
	runId: string
	project: string
}

export type HudScreenOption = {
	value: HudScreen
	label: string
	disabled?: boolean
	/** The run entry's runs: one is opened by the entry itself, several are listed beside the menu. */
	runs?: readonly HudRun[]
}

export type LaunchDraft = {
	project: string | null
	name: string
	/** Null restores saved choices; an object is the user's current draft. */
	selection: CapabilitySelection | null
}

export type HudNavigation = {
	screen: HudScreen
	launch: LaunchDraft | null
}

export type HudNavigationEvent =
	| { type: "screen_selected"; screen: HudScreen }
	| { type: "launch_opened"; project: string | null }
	| { type: "launch_changed"; change: Partial<Pick<LaunchDraft, "name" | "selection">> }
	| { type: "launch_created"; name: string; project: string }
	| { type: "launch_renamed"; from: string; project: string }
	| { type: "launch_closed" }

/** What the app's state allows: a live run has the run screen; setup and a pending restart lock the HUD. */
export type HudLimits = {
	runLive: boolean
	/** No API keys are configured yet: only the overview, the guide and Environment open. */
	setupRequired: boolean
	/** A change waits for Restart app: only Environment stays open. */
	restartRequired: boolean
}

export const initialHudNavigation: HudNavigation = { screen: "projects", launch: null }

/** Draft lifetime follows navigation actions, independently of mounted screens. Launch is selected only with a draft. */
export function reduceHudNavigation(
	state: HudNavigation,
	event: HudNavigationEvent,
): HudNavigation {
	switch (event.type) {
		case "screen_selected":
			return event.screen === "launch" && !state.launch
				? state
				: { ...state, screen: event.screen }
		case "launch_opened":
			return {
				...state,
				screen: "launch",
				launch: { project: event.project, name: event.project ?? "", selection: null },
			}
		case "launch_changed":
			return state.launch
				? { ...state, launch: { ...state.launch, ...event.change } }
				: state
		case "launch_renamed":
			return state.launch?.project === event.from
				? { ...state, launch: { ...state.launch, project: event.project, name: event.project } }
				: state
		case "launch_closed":
			return {
				...state,
				screen: state.screen === "launch" ? "projects" : state.screen,
				launch: null,
			}
		case "launch_created":
			return state.launch?.project === null && state.launch.name.trim() === event.name
				? { ...state, launch: { ...state.launch, project: event.project } }
				: state
	}
}

/** The screen the HUD shows: the selected one, or the overview (Environment under a restart) while it is closed. */
export function visibleScreen(selected: HudScreen, limits: HudLimits): HudScreen {
	if (limits.restartRequired) return "environment"
	if (limits.setupRequired) {
		return selected === "onboarding" || selected === "environment" ? selected : "projects"
	}
	// A run that ends or goes missing leaves the run screen; the guide opens only during setup.
	if (selected === "run" && !limits.runLive) return "projects"
	if (selected === "onboarding") return "projects"
	return selected
}

/**
 * The view menu's entries. The run entry names a single run and counts several, so its
 * width does not grow with them. A lock keeps the plain entries and disables the ones it closes.
 */
export function screenOptions(screen: HudScreen, launchOpen: boolean, limits: HudLimits, runs: readonly HudRun[]): HudScreenOption[] {
	const locked = limits.setupRequired || limits.restartRequired
	// During setup the menu only leads to Environment, and back from it.
	const overviewClosed = limits.restartRequired || (limits.setupRequired && screen !== "environment")
	const options: HudScreenOption[] = []
	if (runs.length > 0 && !locked) {
		const label = runs.length === 1 ? runs[0].project : `${runs.length} Runs`
		options.push({ value: "run", label, runs })
	}
	options.push({ value: "projects", label: "Runs Overview", disabled: overviewClosed })
	options.push({ value: "dependencies", label: "Dependencies", disabled: locked })
	options.push({ value: "environment", label: "Environment" })
	if (launchOpen && !locked) options.push({ value: "launch", label: "Launch" })
	return options
}

/** The overview and Launch keep the same gap below the selectors, whatever the run state. */
export function hasOverviewLayout(screen: HudScreen): boolean {
	return screen === "projects" || screen === "launch"
}
