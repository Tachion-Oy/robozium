// Coordinate HUD history, live text and selection from accepted run updates.
// History owns grouping/recovery; the view owns prompt composition and display selection.
import { RunFrameKind, type RunDelta, type RunProgress, type RunRecord } from "../run/run-contracts"
import type { RunState, RunUpdate } from "../run/run-reducer"
import { initialHistory, updateHudHistory, type HudHistory } from "./hud-history"
import { messageText, type HudLiveText } from "./hud-messages"
import { buildMessageList, initialMessageList, selectHudDisplay, thinkingLine, type HudDisplay, type HudPresentation } from "./hud-view"

export interface HudState extends HudPresentation {
	history: HudHistory
}

export type HudAction =
	| { type: "run"; previousRun: RunState; update: RunUpdate }
	| { type: "select"; index: number; run: RunState }

export function initialHud(): HudState {
	return {
		history: initialHistory(), view: initialMessageList(), liveText: null, selectedMessageId: null, working: true,
		reasoning: null, thinkingLines: [],
	}
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
		liveText: { id, agent: frame.agent, raw: (previous?.raw ?? "") + frame.delta, sequence: frame.sequence },
		working: false,
	}
}

/** Output supersedes live text; a retry discards it while the agent keeps working. */
function settleLiveText(live: HudLiveText | null, events: readonly RunRecord[]): { live: HudLiveText | null; discarded: boolean } {
	for (const event of events) {
		if (!live) break
		if (event.sequence < live.sequence) continue
		switch (event.type) {
			case RunFrameKind.LlmRetry:
				if (event.agent === live.agent) return { live: null, discarded: true }
				break
			case RunFrameKind.ScriptOutput:
				return { live: null, discarded: false }
			case RunFrameKind.Message:
				// A completion without HUD text, such as a tool action, leaves its text visible.
				if (messageText(event) !== null) return { live: null, discarded: false }
				break
		}
	}
	return { live, discarded: false }
}

/** An answered prompt leaves the view: the agent's live text, or its working indicator, shows instead. */
function dismissAnsweredPrompt(state: HudState, previousRun: RunState, run: RunState): HudState {
	return { ...updateHistoryAndView(state, previousRun, run, null), working: true }
}

/** Discarded live text leaves the agent working; newer output or a prompt ends that. */
function updateWorking(state: HudState, next: HudState, run: RunState, settled: ReturnType<typeof settleLiveText>): HudState {
	const newOutput = next.history.messages.at(-1)?.id !== state.history.messages.at(-1)?.id
	const working = !newOutput && !run.prompt && (state.working || settled.discarded)
	return { ...next, liveText: settled.live, working }
}

/** Reported reasoning belongs to the model call in flight; later output or a retry ends that call. */
function settleReasoning(reasoning: HudState["reasoning"], events: readonly RunRecord[]): HudState["reasoning"] {
	if (!reasoning) return null
	const ended = events.some(event => event.sequence > reasoning.sequence
		&& (event.type === RunFrameKind.Message || event.type === RunFrameKind.ScriptOutput || event.type === RunFrameKind.LlmRetry))
	return ended ? null : reasoning
}

function applyProgress(state: HudState, frame: RunProgress): HudState {
	return { ...state, reasoning: { chars: frame.reasoningChars, sequence: frame.sequence } }
}

/** One line per tick while the working indicator shows. */
function applyTick(state: HudState, run: RunState, now: Date, model: string): HudState {
	if (!selectHudMessage(state, run).working) return state
	return { ...state, thinkingLines: [...state.thinkingLines, thinkingLine(now, model, state.reasoning?.chars ?? null)] }
}

/** The thinking lines belong to the working indicator and leave with it. */
function dropStaleThinkingLines(state: HudState, run: RunState): HudState {
	return state.thinkingLines.length === 0 || selectHudMessage(state, run).working ? state : { ...state, thinkingLines: [] }
}

function applyRecords(state: HudState, previousRun: RunState, update: Extract<RunUpdate, { type: "events" | "snapshot" }>): HudState {
	const run = update.run
	const newPrompt = update.type === "snapshot" && run.prompt?.id !== previousRun.prompt?.id
	const breakAfter = newPrompt ? run.prompt?.afterSequence ?? null : null
	const next = updateHistoryAndView(state, previousRun, run, breakAfter)
	// Replayed records can supersede live text even when stored history is unchanged.
	const settled = update.type === "snapshot" && run.prompt
		? { live: null, discarded: false } : settleLiveText(state.liveText, update.receivedEvents)
	const reasoning = settleReasoning(state.reasoning, update.receivedEvents)
	return updateWorking(state, { ...next, reasoning }, run, settled)
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
		case "progress":
			return applyProgress(state, update.frame)
		case "tick":
			return applyTick(state, run, update.now, update.model)
		case "events":
		case "snapshot":
			return applyRecords(state, previousRun, update)
	}
}

export function reduceHud(state: HudState, action: HudAction): HudState {
	if (action.type === "run") return dropStaleThinkingLines(applyRunUpdate(state, action.previousRun, action.update), action.update.run)
	const current = selectHudMessage(state, action.run).currentIndex
	const selectedMessageId = action.index === current ? null : state.view.messages[action.index]?.id ?? null
	return { ...state, selectedMessageId }
}

export function selectHudMessage(state: HudState | null, run: RunState | null): HudDisplay {
	return selectHudDisplay(state, run, state?.history.openScriptId ?? null)
}
