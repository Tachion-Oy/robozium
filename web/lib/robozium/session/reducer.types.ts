import type { StreamingDelta, StreamingMessage } from "../stream"
import type { PipeEventFrame, RunStatus, RunView } from "../wire"
import type { ContentType, StreamLogItem } from "../view-model"

export type HudMessageNavigationDirection =
	| "first"
	| "previous"
	| "next"
	| "latest"

/** Poll/snapshot events coming from run-view HTTP responses. */
export type RunViewEvent =
	| {
			class: "runView"
			type: "received"
			runView: RunView
	  }

/** SSE transport events (frames + connection lifecycle errors). */
export type StreamEvent =
	| { class: "stream"; type: "open_failed"; message: string }
	| { class: "stream"; type: "failed"; message: string }
	| {
			class: "stream"
			type: "frame_received"
			frame: PipeEventFrame
			receivedAt: string
	  }

/** User-command lifecycle events emitted by session actions. */
export type ControlEvent =
	| { class: "control"; type: "reply_submitted"; promptId: string }
	| {
			class: "control"
			type: "hud_message_navigated"
			direction: HudMessageNavigationDirection
	  }
	| { class: "control"; type: "cancel_requested" }
	| { class: "control"; type: "cancel_failed" }
	| { class: "control"; type: "interrupt_requested" }
	| { class: "control"; type: "interrupt_failed" }

/** Frontend content events, independent of the backend protocol. */
export type ContentEvent =
	| { class: "content"; type: "delta"; delta: StreamingDelta }
	| { class: "content"; type: "completed"; messageId: string }
	| { class: "content"; type: "reset" }

/** Single dispatch contract used by the root reducer. */
export type SessionEvent = RunViewEvent | StreamEvent | ControlEvent

export enum RunHudPhase {
	Streaming = "streaming",
	Prompting = "prompting",
	Passive = "passive",
	Done = "done",
}

export enum AgentActivityState {
	Working = "working",
	AwaitingInput = "awaiting-input",
}

export type RuntimeErrorNotification = {
	id: string
	category: string
	kind: string
	level: "warning" | "error"
	message: string
	agentName: string
	data: Record<string, unknown> | null
}

export type LogState = {
	items: StreamLogItem[]
	appliedSequence: number
}

export type HudMessage = {
	id: string
	text: string
	contentType: ContentType
	replyId: string | null
}

export type HudState = {
	messages: HudMessage[]
	selectedMessageId: string | null
	isMessageHistoryPinned: boolean
	streaming: StreamingMessage | null
	lastStreaming: StreamingMessage | null
	isSettling: boolean
	status: RunStatus | null
	prompt: string | null
	promptId: string | null
	currentAgentName: string | null
	dismissedPromptId: string | null
	isCancelling: boolean
	isInterrupting: boolean
	phase: RunHudPhase
}

export type RunSessionState = {
	runId: string
	projectSlug: string | null
	log: LogState
	hud: HudState
	notifications: RuntimeErrorNotification[]
}
