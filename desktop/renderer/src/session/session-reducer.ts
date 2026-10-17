// Compose run reconciliation and HUD presentation in one atomic React update.
// Run actions flow through reduceRun first; history selection affects only the HUD.
import { initialRun, reduceRun, type RunAction, type RunState } from "../run/run-reducer"
import { initialHud, reduceHud, selectHudMessage, type HudState } from "../hud/hud-reducer"
import type { HudDisplay } from "../hud/hud-view"

export interface RunSession {
	run: RunState
	hud: HudState
}

export type SessionAction = RunAction
	| { type: "open"; runId: string; project: string }
	| { type: "select"; index: number }

export function reduceRunSession(state: RunSession | null, action: SessionAction): RunSession | null {
	if (action.type === "open") return { run: initialRun(action.runId, action.project), hud: initialHud() }
	if (!state) return state
	if (action.type === "select") {
		return { ...state, hud: reduceHud(state.hud, { ...action, run: state.run }) }
	}
	const update = reduceRun(state.run, action)
	return { run: update.run, hud: reduceHud(state.hud, { type: "run", previousRun: state.run, update }) }
}

export function selectRunDisplay(session: RunSession | null): HudDisplay {
	return selectHudMessage(session?.hud ?? null, session?.run ?? null)
}
