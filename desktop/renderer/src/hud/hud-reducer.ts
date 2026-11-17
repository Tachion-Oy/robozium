// Coordinate HUD history, live text and selection from accepted run updates, and select one display.
// History owns grouping/recovery. This module composes completed output with the active prompt,
// preserves pinned history and picks what the panel shows.
// The message list changes with messages/prompts; token updates only replace live text.
import { isTerminal, RunFrameKind, type RunDelta, type RunProgress, type RunRecord } from "../run/run-contracts"
import type { RunPrompt, RunState, RunUpdate } from "../run/run-reducer"
import { initialHistory, updateHudHistory, type HudHistory } from "./hud-history"
import { messageText, streamingText, type HudLiveText, type HudMessage, type RecordedHudMessage } from "./hud-messages"

interface HudMessageList {
	messages: readonly HudMessage[]
	indices: ReadonlyMap<string, number>
	activePromptId: string | null
}

export interface HudState {
	history: HudHistory
	view: HudMessageList
	selectedMessageId: string | null
	liveText: HudLiveText | null
	/** The agent works without output newer than its launch, an answered prompt or a discarded attempt. */
	working: boolean
	/** Reasoning last reported for the model call in flight, and where in the stream; none once later output or a retry arrives. */
	reasoning: { chars: number; sequence: number } | null
	/** One line per tick while the working indicator shows, so a long model call does not look frozen. */
	thinkingLines: readonly string[]
}

/** Shown in the streaming style while the agent works without visible output. */
const AGENT_WORKING_TEXT = "Agent is working..."
export const THINKING_LINE_INTERVAL_MS = 5_000
/** Providers report exact reasoning tokens only when a call ends; four characters approximate one. */
const CHARACTERS_PER_TOKEN = 4

/** The time and the model, with a token estimate once the model has streamed reasoning. */
function thinkingLine(now: Date, model: string, reasoningChars: number | null): string {
	const line = `${now.toLocaleTimeString("en-GB")}: ${model} thinking`
	if (!reasoningChars) return line
	return `${line}, ~${Math.round(reasoningChars / CHARACTERS_PER_TOKEN).toLocaleString("en-US")} tokens`
}

/** Agent messages and prompts are Markdown; script and live output stay literal. */
export type ContentType = "plain-text" | "markdown"

export interface HudDisplay {
	id: string
	text: string
	contentType: ContentType
	streaming: boolean
	/** The working indicator stands in for output; it is not agent text. */
	working: boolean
	index: number
	currentIndex: number
	count: number
}

function initialMessageList(): HudMessageList {
	return { messages: [], indices: new Map(), activePromptId: null }
}

function retainPinnedPrompt(previous: HudMessageList, messages: HudMessage[], selectedId: string | null): void {
	if (selectedId === null || messages.some(message => message.id === selectedId)) return
	const index = previous.indices.get(selectedId)
	if (index === undefined) return
	const selected = previous.messages[index]
	if (selected?.source === "prompt") messages.splice(Math.min(index, messages.length), 0, selected)
}

function buildMessageList(
	previous: HudMessageList,
	completed: readonly RecordedHudMessage[],
	prompt: RunPrompt | null,
	selectedId: string | null,
): HudMessageList {
	const messages: HudMessage[] = [...completed]
	let activePromptId: string | null = null
	// A wait without text, as after a failed model call, leaves the latest output in view.
	if (prompt && prompt.text !== "") {
		const match = [...completed].reverse().find(message => message.source === "message" && message.text === prompt.text)
		activePromptId = match?.id ?? `prompt:${prompt.id}`
		if (!match) messages.push({ id: activePromptId, text: prompt.text, source: "prompt" })
	}
	retainPinnedPrompt(previous, messages, selectedId)
	return { messages, indices: new Map(messages.map((message, index) => [message.id, index])), activePromptId }
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

/** Priority: explicitly pinned message, active prompt, live text or the working indicator, latest completed output. */
export function selectHudMessage(state: HudState | null, run: RunState | null): HudDisplay {
	const empty: HudDisplay = { id: "empty", text: "", contentType: "plain-text", streaming: false, working: false, index: 0, currentIndex: 0, count: 0 }
	if (!state || !run) return empty
	const { view, selectedMessageId, liveText } = state
	const promptIndex = view.activePromptId === null ? undefined : view.indices.get(view.activePromptId)
	const live = promptIndex === undefined ? liveText : null
	const liveDisplay = live ? streamingText(live.raw) : ""
	// Live text without visible characters yet, such as leading JSON punctuation, shows the agent working.
	const working = promptIndex === undefined && !isTerminal(run.status) && (live ? !liveDisplay.trim() : state.working)
	const count = view.messages.length + (live || working ? 1 : 0)
	const currentIndex = promptIndex ?? Math.max(0, count - 1)
	const selectedIndex = selectedMessageId === null ? undefined : view.indices.get(selectedMessageId)
	const index = selectedIndex ?? currentIndex
	if (index === view.messages.length && (live || working)) {
		// Settled text stays in the streaming style: it was never a completed HUD message.
		return {
			id: live?.id ?? "working", text: working ? [AGENT_WORKING_TEXT, ...state.thinkingLines].join("\n") : liveDisplay, contentType: "plain-text",
			streaming: !isTerminal(run.status), working, index, currentIndex, count,
		}
	}
	const message = view.messages[index]
	if (!message) return empty
	return {
		id: message.id, text: message.text, working: false, index, currentIndex, count,
		contentType: message.source === "script" ? "plain-text" : "markdown",
		streaming: message.id === state.history.openScriptId && !run.prompt && !isTerminal(run.status),
	}
}
