// The displayed run's state and every change to it, in one atomic React update.
// Run actions reconcile SSE and snapshots into run data first; the HUD part then follows that update.
import { isTerminal, RunFrameKind, RunStatus, type RunDelta, type RunFrame, type RunProgress, type RunRecord, type RunView } from "../run/run-contracts"
import { initialHistory, updateHudHistory, type HudHistory } from "../hud/hud-history"
import { messageText, type HudLiveText } from "../hud/hud-messages"
import {
	buildMessageList, initialMessageList, selectHudMessage, thinkingLine, type HudDisplay, type HudMessageList,
} from "../hud/hud-display"

export interface RunPrompt {
	id: string
	text: string
	/** Last known event when this prompt first appeared; repeated polls keep its position. */
	afterSequence: number
}

export interface RunState {
	runId: string
	project: string
	status: RunStatus
	prompt: RunPrompt | null
	events: readonly RunRecord[]
	completedMessageIds: ReadonlySet<string>
	retrySequences: ReadonlyMap<string, number>
	streamSequence: number
	streamMessage: Pick<RunDelta, "id" | "agent" | "chunk" | "sequence"> | null
	error: string
	unavailable: boolean
	/** A snapshot has been applied since the last error or retry. */
	synchronized: boolean
	/** Prompts this app answered; a late snapshot cannot bring them back. */
	acknowledgedPrompts: ReadonlySet<string>
}

export type RunAction =
	| { type: "frame"; frame: RunFrame }
	| { type: "snapshot"; view: RunView }
	| { type: "error"; message: string; unavailable: boolean }
	| { type: "replied"; promptId: string }
	| { type: "retry" }
	/** A clock beat for consumers that show the run waiting; it changes no run data. */
	| { type: "tick"; now: Date; model: string }

// Replayed records remain part of the update even when storage is unchanged.
// Consumers may need to dismiss transient output superseded by those records.
export type RunUpdate = { run: RunState } & (
	| { type: "delta"; frame: RunDelta }
	| { type: "progress"; frame: RunProgress }
	| { type: "tick"; now: Date; model: string }
	| { type: "events" | "snapshot"; receivedEvents: readonly RunRecord[] }
	| { type: "replied" }
	| { type: "state" }
)

export function initialRun(runId: string, project: string): RunState {
	return {
		runId, project, status: RunStatus.Queued, prompt: null, events: [],
		completedMessageIds: new Set(), retrySequences: new Map(),
		streamSequence: -1, streamMessage: null, error: "", unavailable: false,
		synchronized: false, acknowledgedPrompts: new Set(),
	}
}

function recordEvents(state: RunState, events: readonly RunRecord[], added: readonly RunRecord[]): RunState {
	let completedMessageIds: Set<string> | null = null
	let retrySequences: Map<string, number> | null = null
	let streamMessage = state.streamMessage
	for (const event of added) {
		if (event.type === RunFrameKind.Message && event.id !== null) {
			if (!state.completedMessageIds.has(event.id)) {
				completedMessageIds ??= new Set(state.completedMessageIds)
				completedMessageIds.add(event.id)
			}
			if (streamMessage?.id === event.id) streamMessage = null
		}
		if (event.type === RunFrameKind.LlmRetry) {
			retrySequences ??= new Map(state.retrySequences)
			retrySequences.set(event.agent, Math.max(retrySequences.get(event.agent) ?? -1, event.sequence))
			if (streamMessage?.agent === event.agent && event.sequence >= streamMessage.sequence) streamMessage = null
		}
	}
	return {
		...state, events, streamMessage,
		completedMessageIds: completedMessageIds ?? state.completedMessageIds,
		retrySequences: retrySequences ?? state.retrySequences,
	}
}

/** Snapshots may fill gaps behind newer SSE. Sequence membership owns recovery. */
function mergeEvents(state: RunState, incoming: readonly RunRecord[]): RunState {
	const event = incoming.length === 1 ? incoming[0] : null
	if (event && event.sequence > (state.events.at(-1)?.sequence ?? -1)) {
		return recordEvents(state, [...state.events, event], [event])
	}
	const known = new Set(state.events.map(item => item.sequence))
	const added: RunRecord[] = []
	for (const item of incoming) {
		if (known.has(item.sequence)) continue
		known.add(item.sequence)
		added.push(item)
	}
	if (added.length === 0) return state
	const events = [...state.events, ...added].sort((a, b) => a.sequence - b.sequence)
	return recordEvents(state, events, added)
}

function applyDelta(state: RunState, frame: RunDelta): RunUpdate {
	const run = { ...state, streamSequence: Math.max(state.streamSequence, frame.sequence) }
	const duplicateChunk = state.streamMessage?.id === frame.id && frame.chunk <= state.streamMessage.chunk
	// Snapshot recovery does not advance the SSE cursor: a delayed prefix may still be needed.
	if (frame.sequence <= state.streamSequence || duplicateChunk || state.completedMessageIds.has(frame.id)
		|| frame.sequence <= (state.retrySequences.get(frame.agent) ?? -1)) return { type: "state", run }
	return {
		type: "delta", frame,
		run: { ...run, streamMessage: { id: frame.id, agent: frame.agent, chunk: frame.chunk, sequence: frame.sequence } },
	}
}

/** Progress is transient like a token fragment: a replayed one is dropped. */
function applyProgress(state: RunState, frame: RunProgress): RunUpdate {
	if (frame.sequence <= state.streamSequence) return { type: "state", run: state }
	return { type: "progress", frame, run: { ...state, streamSequence: frame.sequence } }
}

function snapshotPrompt(previous: RunPrompt | null, view: RunView, afterSequence: number): RunPrompt | null {
	if (isTerminal(view.status) || view.promptId === null || view.prompt === null) return null
	if (previous?.id === view.promptId) {
		return previous.text === view.prompt ? previous : { ...previous, text: view.prompt }
	}
	return { id: view.promptId, text: view.prompt, afterSequence }
}

/** The backend acknowledged a reply: the run resumes, and later snapshots cannot revive the prompt. */
function applyReply(state: RunState, promptId: string): RunUpdate {
	return {
		type: "replied",
		run: {
			...state,
			acknowledgedPrompts: new Set([...state.acknowledgedPrompts, promptId]),
			prompt: state.prompt?.id === promptId ? null : state.prompt,
			status: state.status === RunStatus.AwaitingUserInput ? RunStatus.Running : state.status,
		},
	}
}

function applySnapshot(state: RunState, view: RunView): RunUpdate {
	// Token fragments and progress are transient and are not recovered from history.
	const receivedEvents = view.frames.filter(frame => frame.type !== RunFrameKind.MessageDelta && frame.type !== RunFrameKind.LlmProgress)
	const next = mergeEvents(state, receivedEvents)
	// A snapshot still awaiting an answered prompt was taken before the reply.
	const answered = view.promptId !== null && state.acknowledgedPrompts.has(view.promptId)
	const afterSequence = receivedEvents.length > 0
		? receivedEvents.reduce((sequence, event) => Math.max(sequence, event.sequence), -1)
		: Math.max(next.events.at(-1)?.sequence ?? -1, state.streamSequence)
	return {
		type: "snapshot", receivedEvents,
		run: {
			...next, synchronized: true, error: view.error ?? state.error,
			status: answered && view.status === RunStatus.AwaitingUserInput ? RunStatus.Running : view.status,
			prompt: answered ? null : snapshotPrompt(state.prompt, view, afterSequence),
		},
	}
}

export function reduceRun(state: RunState, action: RunAction): RunUpdate {
	switch (action.type) {
		case "error": return { type: "state", run: { ...state, synchronized: false, error: action.message, unavailable: action.unavailable } }
		case "retry": return { type: "state", run: { ...state, synchronized: false, error: "", unavailable: false } }
		case "replied": return applyReply(state, action.promptId)
		case "snapshot": return applySnapshot(state, action.view)
		case "tick": return { type: "tick", run: state, now: action.now, model: action.model }
		case "frame": {
			if (action.frame.type === RunFrameKind.MessageDelta) return applyDelta(state, action.frame)
			if (action.frame.type === RunFrameKind.LlmProgress) return applyProgress(state, action.frame)
			const next = mergeEvents(state, [action.frame])
			return {
				type: "events", receivedEvents: [action.frame],
				run: { ...next, streamSequence: Math.max(state.streamSequence, action.frame.sequence) },
			}
		}
	}
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

function applyHudDelta(state: HudState, previousRun: RunState, run: RunState, frame: RunDelta): HudState {
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

function applyHudProgress(state: HudState, frame: RunProgress): HudState {
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
			return applyHudDelta(state, previousRun, run, update.frame)
		case "progress":
			return applyHudProgress(state, update.frame)
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
