import type { CapabilitySelection } from "./wire"

export type HudScreen = "projects" | "run" | "dependencies" | "launch" | "environment"

export type LaunchDraft = {
	project: string | null
	name: string
	/** Null restores saved choices; an object is the user's current draft. */
	selection: CapabilitySelection | null
}

export type HudNavigation = {
	runId: string | null
	screen: HudScreen
	launch: LaunchDraft | null
}

export type HudNavigationEvent =
	| { type: "reset"; runId: string | null }
	| { type: "screen_selected"; screen: HudScreen }
	| { type: "launch_opened"; project: string | null }
	| { type: "launch_changed"; change: Partial<Pick<LaunchDraft, "name" | "selection">> }
	| { type: "launch_created"; name: string; project: string }
	| { type: "launch_closed" }

export function initialHudNavigation(runId: string | null): HudNavigation {
	return { runId, screen: runId ? "run" : "projects", launch: null }
}

/** Draft lifetime follows navigation actions, independently of mounted screens. */
export function reduceHudNavigation(
	state: HudNavigation,
	event: HudNavigationEvent,
): HudNavigation {
	switch (event.type) {
		case "reset":
			return initialHudNavigation(event.runId)
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
