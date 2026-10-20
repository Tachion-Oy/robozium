// Reconcile SSE and snapshots into run data: events, status, prompt and stream cursors.
// Return accepted updates for consumers; this module has no HUD state or display rules.
import { isTerminal, RunEventType, RunStatus, type RunDelta, type RunFrame, type RunRecord, type RunView } from "./run-contracts"

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

// Replayed records remain part of the update even when storage is unchanged.
// Consumers may need to dismiss transient output superseded by those records.
export type RunUpdate = { run: RunState } & (
	| { type: "delta"; frame: RunDelta }
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
		if (event.type === RunEventType.Message && event.id !== null) {
			if (!state.completedMessageIds.has(event.id)) {
				completedMessageIds ??= new Set(state.completedMessageIds)
				completedMessageIds.add(event.id)
			}
			if (streamMessage?.id === event.id) streamMessage = null
		}
		if (event.type === RunEventType.LlmRetry) {
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
	// Token fragments are transient and cannot be recovered from history.
	const receivedEvents = view.frames.filter(frame => frame.type !== RunEventType.MessageDelta)
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
		case "frame": {
			if (action.frame.type === RunEventType.MessageDelta) return applyDelta(state, action.frame)
			const next = mergeEvents(state, [action.frame])
			return {
				type: "events", receivedEvents: [action.frame],
				run: { ...next, streamSequence: Math.max(state.streamSequence, action.frame.sequence) },
			}
		}
	}
}
