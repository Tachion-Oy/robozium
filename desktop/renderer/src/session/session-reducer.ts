// The displayed run's state and every change to it. One reducer handles each action once:
// it reconciles SSE and snapshots into run data and updates what the HUD keeps in the same step.
import { isTerminal, RunFrameKind, RunStatus, type RunDelta, type RunProgress, type RunRecord, type RunView } from "../run/run-contracts"
import type { RunUpdate } from "../run/run-updates"
import { initialHistory, updateHudHistory, type HudHistory } from "../hud/hud-history"
import { messageText } from "../hud/hud-messages"
import { buildMessageList, initialMessageList, selectRunDisplay, thinkingLine, type HudMessageList } from "../hud/hud-display"

export interface RunPrompt {
	id: string
	text: string
}

/** What the backend reported, the text being streamed, and the cursors that decide which token fragments are accepted. */
export interface RunState {
	runId: string
	project: string
	status: RunStatus
	prompt: RunPrompt | null
	events: readonly RunRecord[]
	completedMessageIds: ReadonlySet<string>
	retrySequences: ReadonlyMap<string, number>
	streamSequence: number
	/** The message whose token fragments arrived last, and its latest fragment; a retry of its agent ends it. */
	streamMessage: Pick<RunDelta, "id" | "agent" | "chunk" | "sequence"> | null
	/** The raw text streamed for streamMessage, until later output, a retry or a prompt takes its place. */
	liveText: string | null
	error: string
	unavailable: boolean
	/** A snapshot has been applied since the last error or retry. */
	synchronized: boolean
	/** Prompts this app answered; a late snapshot cannot bring them back. */
	acknowledgedPrompts: ReadonlySet<string>
}

/** What the single-message panel keeps beside the run data. */
export interface HudState {
	history: HudHistory
	/**
	 * Completed output with the active prompt, indexed by id: what the panel pages through.
	 * Kept here, not computed per redraw: finding a pinned message or the prompt by search costs
	 * tens of microseconds per redraw in a long run.
	 */
	view: HudMessageList
	selectedMessageId: string | null
	/** No output since the launch, an answered prompt or a discarded attempt; the display decides whether the indicator shows. */
	awaitingOutput: boolean
	/** Reasoning last reported for the model call in flight, and where in the stream; none once later output or a retry arrives. */
	reasoning: { chars: number; sequence: number } | null
	/** One line per tick while the working indicator shows, so a long model call does not look frozen. */
	thinkingLines: readonly string[]
}

export interface RunSession {
	run: RunState
	hud: HudState
}

/** What happens to the displayed run: updates from the backend, an acknowledged reply, a retry and the clock. */
type RunAction = RunUpdate
	| { type: "replied"; promptId: string }
	| { type: "retry" }
	/** A clock beat: one more thinking line while the working indicator shows. */
	| { type: "tick"; now: Date; model: string }

export type SessionAction = RunAction
	| { type: "open"; runId: string; project: string }
	| { type: "select"; index: number }

interface SettledLiveText {
	live: string | null
	discarded: boolean
}

function initialSession(runId: string, project: string): RunSession {
	return {
		run: {
			runId, project, status: RunStatus.Queued, prompt: null, events: [],
			completedMessageIds: new Set(), retrySequences: new Map(),
			streamSequence: -1, streamMessage: null, liveText: null, error: "", unavailable: false,
			synchronized: false, acknowledgedPrompts: new Set(),
		},
		hud: {
			history: initialHistory(), view: initialMessageList(), selectedMessageId: null, awaitingOutput: true,
			reasoning: null, thinkingLines: [],
		},
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

function updateHistoryAndView(state: RunSession, run: RunState, breakAfter: number | null): HudState {
	const hud = state.hud
	const history = updateHudHistory(hud.history, state.run.events, run.events, breakAfter)
	if (history.messages === hud.history.messages && run.prompt === state.run.prompt) return { ...hud, history }
	return { ...hud, history, view: buildMessageList(history.messages, run.prompt) }
}

/** An accepted token fragment extends the live text. A replayed, duplicate or superseded one only moves the cursor. */
function applyDelta(state: RunSession, frame: RunDelta): RunSession {
	const previous = state.run
	const stream = previous.streamMessage
	const run = { ...previous, streamSequence: Math.max(previous.streamSequence, frame.sequence) }
	const duplicateChunk = stream?.id === frame.id && frame.chunk <= stream.chunk
	// Snapshot recovery does not advance the SSE cursor: a delayed prefix may still be needed.
	if (frame.sequence <= previous.streamSequence || duplicateChunk || previous.completedMessageIds.has(frame.id)
		|| frame.sequence <= (previous.retrySequences.get(frame.agent) ?? -1)) return { run, hud: state.hud }
	// Text still on show continues. Otherwise this fragment starts the text and closes the script output before it.
	let liveText = frame.delta
	let breakAfter: number | null = frame.sequence
	if (previous.liveText !== null && stream?.id === frame.id) {
		liveText = previous.liveText + frame.delta
		breakAfter = null
	}
	const accepted = { ...run, liveText, streamMessage: { id: frame.id, agent: frame.agent, chunk: frame.chunk, sequence: frame.sequence } }
	const hud = updateHistoryAndView(state, accepted, breakAfter)
	return { run: accepted, hud: { ...hud, awaitingOutput: false } }
}

/** Progress is transient like a token fragment: a replayed one is dropped. */
function applyProgress(state: RunSession, frame: RunProgress): RunSession {
	if (frame.sequence <= state.run.streamSequence) return { run: state.run, hud: state.hud }
	return {
		run: { ...state.run, streamSequence: frame.sequence },
		hud: { ...state.hud, reasoning: { chars: frame.reasoningChars, sequence: frame.sequence } },
	}
}

/** Output at or after the streamed message supersedes its live text; a retry discards it while the agent keeps working. */
function settleLiveText(state: RunSession, events: readonly RunRecord[]): SettledLiveText {
	const live = state.run.liveText
	const stream = state.run.streamMessage
	if (live === null || stream === null) return { live, discarded: false }
	for (const event of events) {
		if (event.sequence < stream.sequence) continue
		switch (event.type) {
			case RunFrameKind.LlmRetry:
				if (event.agent === stream.agent) return { live: null, discarded: true }
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

/** Reported reasoning belongs to the model call in flight; later output or a retry ends that call. */
function settleReasoning(reasoning: HudState["reasoning"], events: readonly RunRecord[]): HudState["reasoning"] {
	if (!reasoning) return null
	const ended = events.some(event => event.sequence > reasoning.sequence
		&& (event.type === RunFrameKind.Message || event.type === RunFrameKind.ScriptOutput || event.type === RunFrameKind.LlmRetry))
	return ended ? null : reasoning
}

/**
 * Records arrived, possibly ones already known: replayed records can supersede live text even
 * when stored history is unchanged. Discarded live text leaves the agent working; newer output
 * or a prompt ends that.
 */
function applyRecords(
	state: RunSession, run: RunState, received: readonly RunRecord[], breakAfter: number | null, settled: SettledLiveText,
): RunSession {
	const hud = updateHistoryAndView(state, run, breakAfter)
	const newOutput = hud.history.messages.at(-1)?.id !== state.hud.history.messages.at(-1)?.id
	const awaitingOutput = !newOutput && !run.prompt && (state.hud.awaitingOutput || settled.discarded)
	const reasoning = settleReasoning(state.hud.reasoning, received)
	return { run: { ...run, liveText: settled.live }, hud: { ...hud, reasoning, awaitingOutput } }
}

function applyRecord(state: RunSession, frame: RunRecord): RunSession {
	const merged = mergeEvents(state.run, [frame])
	const run = { ...merged, streamSequence: Math.max(state.run.streamSequence, frame.sequence) }
	return applyRecords(state, run, [frame], null, settleLiveText(state, [frame]))
}

function snapshotPrompt(previous: RunPrompt | null, view: RunView): RunPrompt | null {
	if (isTerminal(view.status) || view.promptId === null || view.prompt === null) return null
	if (previous?.id === view.promptId) {
		return previous.text === view.prompt ? previous : { ...previous, text: view.prompt }
	}
	return { id: view.promptId, text: view.prompt }
}

function applySnapshot(state: RunSession, view: RunView): RunSession {
	const previous = state.run
	// Token fragments and progress are transient and are not recovered from history.
	const received = view.frames.filter(frame => frame.type !== RunFrameKind.MessageDelta && frame.type !== RunFrameKind.LlmProgress)
	const merged = mergeEvents(previous, received)
	// A snapshot still awaiting an answered prompt was taken before the reply.
	const answered = view.promptId !== null && previous.acknowledgedPrompts.has(view.promptId)
	const run: RunState = {
		...merged, synchronized: true, error: view.error ?? previous.error,
		status: answered && view.status === RunStatus.AwaitingUserInput ? RunStatus.Running : view.status,
		prompt: answered ? null : snapshotPrompt(previous.prompt, view),
	}
	// A new prompt closes the script output before it, at the last event known when the prompt
	// first appeared. Repeated polls show the same prompt and leave that position alone.
	let breakAfter: number | null = null
	if (run.prompt && run.prompt.id !== previous.prompt?.id) {
		if (received.length > 0) breakAfter = received.reduce((sequence, event) => Math.max(sequence, event.sequence), -1)
		else breakAfter = Math.max(merged.events.at(-1)?.sequence ?? -1, previous.streamSequence)
	}
	// A prompt takes the place of live text.
	const settled = run.prompt ? { live: null, discarded: false } : settleLiveText(state, received)
	return applyRecords(state, run, received, breakAfter, settled)
}

/**
 * The backend acknowledged a reply: the run resumes, and later snapshots cannot revive the prompt.
 * The answered prompt leaves the view: the agent's live text, or its working indicator, shows instead.
 */
function applyReply(state: RunSession, promptId: string): RunSession {
	const previous = state.run
	const run: RunState = {
		...previous,
		acknowledgedPrompts: new Set([...previous.acknowledgedPrompts, promptId]),
		prompt: previous.prompt?.id === promptId ? null : previous.prompt,
		status: previous.status === RunStatus.AwaitingUserInput ? RunStatus.Running : previous.status,
	}
	return { run, hud: { ...updateHistoryAndView(state, run, null), awaitingOutput: true } }
}

/** One line per tick while the working indicator is what the panel displays; a pinned message shows none. */
function applyTick(state: RunSession, now: Date, model: string): RunSession {
	const hud = state.hud
	if (!selectRunDisplay(state).working) return { run: state.run, hud }
	const line = thinkingLine(now, model, hud.reasoning?.chars ?? null)
	return { run: state.run, hud: { ...hud, thinkingLines: [...hud.thinkingLines, line] } }
}

/** Picking the latest message follows new output again; any other message stays pinned. */
function selectMessage(state: RunSession, index: number): RunSession {
	const current = selectRunDisplay(state).currentIndex
	const selectedMessageId = index === current ? null : state.hud.view.messages[index]?.id ?? null
	return { run: state.run, hud: { ...state.hud, selectedMessageId } }
}

function applyRunAction(state: RunSession, action: RunAction): RunSession {
	switch (action.type) {
		case "error":
			return { run: { ...state.run, synchronized: false, error: action.message, unavailable: action.unavailable }, hud: state.hud }
		case "retry":
			return { run: { ...state.run, synchronized: false, error: "", unavailable: false }, hud: state.hud }
		case "replied":
			return applyReply(state, action.promptId)
		case "snapshot":
			return applySnapshot(state, action.view)
		case "tick":
			return applyTick(state, action.now, action.model)
		case "frame":
			if (action.frame.type === RunFrameKind.MessageDelta) return applyDelta(state, action.frame)
			if (action.frame.type === RunFrameKind.LlmProgress) return applyProgress(state, action.frame)
			return applyRecord(state, action.frame)
	}
}

/** The thinking lines belong to the working indicator and leave with it. */
function dropStaleThinkingLines(state: RunSession): RunSession {
	if (state.hud.thinkingLines.length === 0 || selectRunDisplay(state).working) return state
	return { run: state.run, hud: { ...state.hud, thinkingLines: [] } }
}

export function reduceRunSession(state: RunSession | null, action: SessionAction): RunSession | null {
	if (action.type === "open") return initialSession(action.runId, action.project)
	if (!state) return state
	if (action.type === "select") return selectMessage(state, action.index)
	return dropStaleThinkingLines(applyRunAction(state, action))
}
