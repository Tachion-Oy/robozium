// Coordinate HUD history, live text and selection from accepted run updates.
// History owns grouping/recovery; the view owns prompt composition and display selection.
import { RunEventType, type RunDelta, type RunRecord } from "../run/run-contracts"
import type { RunState, RunUpdate } from "../run/run-reducer"
import { initialHistory, updateHudHistory, type HudHistory } from "./hud-history"
import { messageText, type HudLiveText } from "./hud-messages"
import { buildMessageList, initialMessageList, selectHudDisplay, type HudDisplay, type HudPresentation } from "./hud-view"

export interface HudState extends HudPresentation {
	history: HudHistory
}

export type HudAction =
	| { type: "run"; previousRun: RunState; update: RunUpdate }
	| { type: "select"; index: number; run: RunState }

export function initialHud(): HudState {
	return { history: initialHistory(), view: initialMessageList(), liveText: null, selectedMessageId: null }
}

function updateHistoryAndView(state: HudState, previousRun: RunState, run: RunState, breakAfter: number | null): HudState {
	const history = updateHudHistory(state.history, previousRun.events, run.events, breakAfter, state.selectedMessageId)
	if (history.messages === state.history.messages && run.prompt === previousRun.prompt) return { ...state, history }
	const view = buildMessageList(state.view, history.messages, run.prompt, state.selectedMessageId)
	const selectedMessageId = state.selectedMessageId !== null && view.indices.has(state.selectedMessageId) ? state.selectedMessageId : null
	return { ...state, history, view, selectedMessageId }
}

function applyDelta(state: HudState, previousRun: RunState, run: RunState, frame: RunDelta): HudState {
	const id = `message:${frame.id}`
	const previous = state.liveText?.id === id ? state.liveText : null
	const next = updateHistoryAndView(state, previousRun, run, previous ? null : frame.sequence)
	return {
		...next,
		liveText: { id, agent: frame.agent, raw: (previous?.raw ?? "") + frame.delta, sequence: frame.sequence, settling: false },
	}
}

function settleLiveText(live: HudLiveText | null, events: readonly RunRecord[]): HudLiveText | null {
	for (const event of events) {
		if (!live) return null
		if (event.sequence < live.sequence) continue
		switch (event.type) {
			case RunEventType.LlmRetry:
				if (event.agent === live.agent) return null
				break
			case RunEventType.ScriptOutput:
				return null
			case RunEventType.Message:
				if (messageText(event) !== null) return null
				if (`message:${event.id}` === live.id) live = { ...live, settling: true }
				break
		}
	}
	return live
}

/** An answered prompt leaves the view, so the agent's live text can show again. */
function dismissAnsweredPrompt(state: HudState, previousRun: RunState, run: RunState): HudState {
	return updateHistoryAndView(state, previousRun, run, null)
}

function applyRunUpdate(state: HudState, previousRun: RunState, update: RunUpdate): HudState {
	const run = update.run
	switch (update.type) {
		case "state":
			return state
		case "replied":
			return dismissAnsweredPrompt(state, previousRun, run)
		case "delta":
			return applyDelta(state, previousRun, run, update.frame)
		case "events":
		case "snapshot": {
			const newPrompt = update.type === "snapshot" && run.prompt?.id !== previousRun.prompt?.id
			const breakAfter = newPrompt ? run.prompt?.afterSequence ?? null : null
			const next = updateHistoryAndView(state, previousRun, run, breakAfter)
			// Replayed records can supersede live text even when stored history is unchanged.
			const liveText = update.type === "snapshot" && run.prompt ? null : settleLiveText(state.liveText, update.receivedEvents)
			return { ...next, liveText }
		}
	}
}

export function reduceHud(state: HudState, action: HudAction): HudState {
	if (action.type === "run") return applyRunUpdate(state, action.previousRun, action.update)
	const current = selectHudMessage(state, action.run).currentIndex
	const selectedMessageId = action.index === current ? null : state.view.messages[action.index]?.id ?? null
	return { ...state, selectedMessageId }
}

export function selectHudMessage(state: HudState | null, run: RunState | null): HudDisplay {
	return selectHudDisplay(state, run, state?.history.openScriptId ?? null)
}
