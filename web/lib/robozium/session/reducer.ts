import {
	getFrameSequence,
	mapFrameToLogItem,
	mapRole,
	scriptOutputToItem,
} from "../stream"
import { StreamLogItemKind, StreamLogRole, type StreamLogItem } from "../view-model"
import {
	PipeEventType,
	RunLifecycleKind,
	type MessageDeltaEventFrame,
	type MessageEventFrame,
	type RunLifecycleEventFrame,
	type RuntimeEventFrame,
	type ScriptOutputEventFrame,
} from "../wire"
import {
	getActiveStreamingMessageFromHud,
	reconcileHudState,
	reduceHudState,
} from "./hud-reducer"
import { reduceNotifications } from "./notification-reducer"
import {
	AgentActivityState,
	RunHudPhase,
	type ContentEvent,
	type ControlEvent,
	type RunViewEvent,
	type StreamEvent,
	type RunSessionState,
	type SessionEvent,
} from "./reducer.types"

export { AgentActivityState, RunHudPhase } from "./reducer.types"

export function agentActivityStateForPhase(
	phase: RunHudPhase,
): AgentActivityState {
	return phase === RunHudPhase.Prompting
		? AgentActivityState.AwaitingInput
		: AgentActivityState.Working
}

export type {
	RunSessionState,
	LogState,
	HudState,
	HudMessage,
	HudMessageNavigationDirection,
	RuntimeErrorNotification,
	SessionEvent,
} from "./reducer.types"

export function createInitialRunSessionState(runId: string): RunSessionState {
	return {
		runId,
		projectSlug: null,
		log: {
			items: [],
			appliedSequence: 0,
		},
		hud: {
			messages: [],
			selectedMessageId: null,
			isMessageHistoryPinned: false,
			streaming: null,
			lastStreaming: null,
			isSettling: false,
			status: null,
			prompt: null,
			promptId: null,
			currentAgentName: null,
			dismissedPromptId: null,
			isCancelling: false,
			isInterrupting: false,
			phase: RunHudPhase.Passive,
		},
		notifications: [],
	}
}

export function getActiveStreamingMessage(state: RunSessionState) {
	return getActiveStreamingMessageFromHud(state.hud)
}

/**
 * Permanent stream-open failures already live in the notification timeline so
 * the toast can render them. Reuse that durable signal for UI recovery instead
 * of introducing a second client-side availability state.
 */
export function hasPermanentRunFailure(state: RunSessionState): boolean {
	return state.notifications.some(
		(notification) =>
			notification.category === "stream" &&
			notification.kind === "open_failed" &&
			notification.agentName === "system",
	)
}

/**
 * A run route has no more live work to display once the root run is terminal
 * or the backend says the run can no longer be opened. Keep this predicate in
 * the session layer so transport teardown and route navigation cannot drift.
 */
export function shouldExitRunView(state: RunSessionState): boolean {
	return (
		state.hud.phase === RunHudPhase.Done || hasPermanentRunFailure(state)
	)
}

const terminalStatuses = new Set(["completed", "failed", "cancelled"])

function reduceContentState(
	state: RunSessionState,
	event: ContentEvent,
): RunSessionState {
	return { ...state, hud: reduceHudState(state.hud, event) }
}

function appendLogItem(
	state: RunSessionState,
	item: StreamLogItem,
): RunSessionState {
	return { ...state, log: { ...state.log, items: [...state.log.items, item] } }
}

function completeScript(state: RunSessionState): RunSessionState {
	const script = state.hud.streaming
	if (script?.role !== StreamLogRole.Script) return state
	state = appendLogItem(state, scriptOutputToItem(script.text))
	return reduceContentState(state, {
		class: "content",
		type: "completed",
		messageId: script.messageId,
	})
}

function reduceRunViewState(
	state: RunSessionState,
	event: RunViewEvent,
): RunSessionState {
	const view = event.runView
	const newPrompt =
		view.current_prompt_id !== null &&
		view.current_prompt_id !== state.hud.promptId &&
		view.current_prompt_id !== state.hud.dismissedPromptId
	if (newPrompt || terminalStatuses.has(view.status)) state = completeScript(state)
	return { ...state, hud: reduceHudState(state.hud, event) }
}

function reduceControlState(
	state: RunSessionState,
	event: ControlEvent,
): RunSessionState {
	if (event.type === "reply_submitted") state = completeScript(state)
	return { ...state, hud: reduceHudState(state.hud, event) }
}

function reduceScriptOutputState(
	state: RunSessionState,
	frame: ScriptOutputEventFrame,
): RunSessionState {
	const hud = state.hud
	const script = hud.streaming?.role === StreamLogRole.Script ? hud.streaming : null
	return reduceContentState(state, {
		class: "content",
		type: "delta",
		delta: {
			messageId: script?.messageId ?? `script:${frame.sequence}`,
			chunkIndex: script ? script.chunkIndex + 1 : 0,
			agentName: script ? script.agentName : hud.currentAgentName,
			role: StreamLogRole.Script,
			contentType: "plain-text",
			text: frame.payload.content,
		},
	})
}

function reduceMessageDeltaState(
	state: RunSessionState,
	frame: MessageDeltaEventFrame,
	initial: boolean,
): RunSessionState {
	state = completeScript(state)
	// First snapshots preserve boundaries without restoring historical LLM tokens.
	if (initial) return state
	return reduceContentState(state, {
		class: "content",
		type: "delta",
		delta: {
			messageId: frame.payload.message_id,
			chunkIndex: frame.payload.chunk_index,
			agentName: frame.payload.agent_name,
			role: mapRole(frame.payload.role),
			contentType: "markdown",
			text: frame.payload.delta,
		},
	})
}

function reduceMessageState(
	state: RunSessionState,
	frame: MessageEventFrame,
): RunSessionState {
	state = appendLogItem(completeScript(state), mapFrameToLogItem(frame))
	if (!frame.message_id) return state
	return reduceContentState(state, {
		class: "content",
		type: "completed",
		messageId: frame.message_id,
	})
}

function reduceLifecycleState(
	state: RunSessionState,
	frame: RunLifecycleEventFrame,
): RunSessionState {
	state = appendLogItem(completeScript(state), mapFrameToLogItem(frame))
	if (frame.payload.kind !== RunLifecycleKind.Stopped) return state
	const messageId = state.hud.streaming?.messageId
	if (messageId) {
		state = reduceContentState(state, { class: "content", type: "completed", messageId })
	}
	if (frame.payload.parent_agent_name == null && frame.payload.status) {
		state = { ...state, hud: { ...state.hud, status: frame.payload.status } }
	}
	return state
}

function reduceRuntimeState(
	state: RunSessionState,
	frame: RuntimeEventFrame,
): RunSessionState {
	const active = state.hud.streaming ?? state.hud.lastStreaming
	if (
		frame.payload.category === "llm" &&
		frame.payload.kind === "retrying" &&
		active?.role !== StreamLogRole.Script
	) {
		return reduceContentState(state, { class: "content", type: "reset" })
	}
	return state
}

function reduceStreamFailureState(
	state: RunSessionState,
	message: string,
): RunSessionState {
	return appendLogItem(state, {
		kind: StreamLogItemKind.Message,
		role: StreamLogRole.Error,
		content: message,
	})
}

function reduceStreamState(
	state: RunSessionState,
	event: StreamEvent,
	initial: boolean,
): RunSessionState {
	if (event.type !== "frame_received") {
		state = reduceStreamFailureState(state, event.message)
	} else {
		const { frame } = event
		const sequence = getFrameSequence(frame)
		if (sequence <= state.log.appliedSequence) return state
		switch (frame.type) {
			case PipeEventType.ScriptOutput:
				state = reduceScriptOutputState(state, frame)
				break
			case PipeEventType.MessageDelta:
				state = reduceMessageDeltaState(state, frame, initial)
				break
			case PipeEventType.Message:
				state = reduceMessageState(state, frame)
				break
			case PipeEventType.RunLifecycle:
				state = reduceLifecycleState(state, frame)
				break
			case PipeEventType.RuntimeEvent:
				state = reduceRuntimeState(state, frame)
				break
		}
		state = { ...state, log: { ...state.log, appliedSequence: sequence } }
	}
	return {
		...state,
		notifications: initial
			? state.notifications
			: reduceNotifications(state.notifications, state.runId, event),
	}
}

/** Dispatch wire input; delta/completion/reset only own streaming state. */
function reduceSessionEvent(
	state: RunSessionState,
	event: SessionEvent,
	initial: boolean,
): RunSessionState {
	switch (event.class) {
		case "runView":
			return reduceRunViewState(state, event)
		case "control":
			return reduceControlState(state, event)
		case "stream":
			return reduceStreamState(state, event, initial)
	}
}

/** The session owns chronological recovery, followed by one history reconciliation. */
export function reduceRunSessionState(
	state: RunSessionState,
	event: SessionEvent,
): RunSessionState {
	const previous = state
	const initial = event.class === "runView" && state.hud.status === null
	if (event.class === "runView") {
		const frames = [...event.runView.message_trace].sort(
			(a, b) => getFrameSequence(a) - getFrameSequence(b),
		)
		for (const frame of frames) {
			state = reduceSessionEvent(state, { class: "stream", type: "frame_received", frame }, initial)
		}
		state = { ...state, projectSlug: event.runView.project }
	}
	state = reduceSessionEvent(state, event, initial)
	if (state === previous) return state
	return {
		...state,
		hud: reconcileHudState(
			previous.hud, state.hud, state.log.items, previous.log.items.length, event,
		),
	}
}
