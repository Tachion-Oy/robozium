import type { CapabilitySelection } from "./wire"

export type HudScreen = "projects" | "run" | "dependencies" | "launch"

export type LaunchDraft = {
	project: string | null
	name: string
	capabilities: CapabilitySelection
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
	| { type: "launch_changed"; change: Partial<Pick<LaunchDraft, "name" | "capabilities">> }
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
				launch: { project: event.project, name: event.project ?? "", capabilities: {} },
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
	}
}
