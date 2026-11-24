// Run vocabulary shared by payload validation, reconciliation and HUD consumers: the desktop's
// frame kinds and the complete value sets the backend uses for roles, phases and statuses.
// A value that one module alone reacts to lives in that module (run-payloads, hud-messages).

/** Discriminant of RunFrame. The parser maps wire frames to these kinds; the last four have no wire frame of their own. */
export const RunFrameKind = {
	Message: "message",
	MessageDelta: "message_delta",
	ScriptOutput: "script_output",
	Lifecycle: "run_lifecycle",
	// Frames the parser derives from runtime events: a model call's start or success, a model retry,
	// a model call's progress, and a notice the user should see.
	LlmCall: "llm_call",
	LlmRetry: "llm_retry",
	LlmProgress: "llm_progress",
	RuntimeNotice: "runtime_notice",
} as const

export enum MessageRole {
	Assistant = "assistant",
	User = "user",
	System = "system",
	Error = "error",
}

/** Severity the runtime attaches to each of its events. */
export enum RuntimeLevel {
	Debug = "debug",
	Info = "info",
	Warning = "warning",
	Error = "error",
}

export enum LifecyclePhase {
	Started = "started",
	Stopped = "stopped",
}
export enum LifecycleStatus {
	Running = "running",
	Completed = "completed",
	Failed = "failed",
	Cancelled = "cancelled",
}
/** Lifecycle payload fields shown in the message log banner, in wire order. */
export const LIFECYCLE_DETAIL_KEYS = [
	"parent_agent_name", "status", "api_name", "model_name", "max_context_tokens", "temperature",
] as const
export type LifecycleDetails = Readonly<Partial<Record<typeof LIFECYCLE_DETAIL_KEYS[number], string | number | null>>>

export enum RunStatus {
	Queued = "queued",
	Running = "running",
	AwaitingUserInput = "awaiting_user_input",
	Cancelling = "cancelling",
	Completed = "completed",
	Failed = "failed",
	Cancelled = "cancelled",
}
export const runLabels: Record<RunStatus, string> = {
	[RunStatus.Queued]: "Queued",
	[RunStatus.Running]: "Running",
	[RunStatus.AwaitingUserInput]: "Awaiting input",
	[RunStatus.Cancelling]: "Cancelling",
	[RunStatus.Completed]: "Completed",
	[RunStatus.Failed]: "Failed",
	[RunStatus.Cancelled]: "Cancelled",
}

export function isTerminal(status: RunStatus): boolean {
	return status === RunStatus.Completed || status === RunStatus.Failed || status === RunStatus.Cancelled
}

export type RunFrame = { sequence: number } & (
	| {
		type: typeof RunFrameKind.Message; id: string | null; role: MessageRole; content: string; kind: string | null; caller: string | null
		/** Its truncation removes it from the agent's context from the start, so the agent never sees it. */
		hiddenFromAgent: boolean
	}
	| { type: typeof RunFrameKind.MessageDelta; id: string; delta: string; chunk: number; agent: string }
	/** A model call started, or returned its reply. */
	| { type: typeof RunFrameKind.LlmCall; started: boolean }
	| { type: typeof RunFrameKind.LlmRetry; agent: string }
	/** Reasoning characters the model call in flight has streamed so far. */
	| { type: typeof RunFrameKind.LlmProgress; reasoningChars: number }
	/** A runtime event meant for the user, shown as the runtime wrote it. */
	| { type: typeof RunFrameKind.RuntimeNotice; agent: string; level: RuntimeLevel; message: string }
	/** Text a tool printed while it ran, and that tool's name. */
	| { type: typeof RunFrameKind.ScriptOutput; content: string; caller: string | null }
	| {
		type: typeof RunFrameKind.Lifecycle
		phase: LifecyclePhase
		agent: string
		status: LifecycleStatus | null
		details: LifecycleDetails
	}
)
export type RunDelta = Extract<RunFrame, { type: typeof RunFrameKind.MessageDelta }>
export type RunProgress = Extract<RunFrame, { type: typeof RunFrameKind.LlmProgress }>
export type RunCall = Extract<RunFrame, { type: typeof RunFrameKind.LlmCall }>
/** Deltas, progress and a call's start and success report on the model call in flight; none is kept as history. */
export type RunRecord = Exclude<RunFrame, RunDelta | RunProgress | RunCall>
export interface RunView {
	project: string
	status: RunStatus
	frames: RunFrame[]
	promptId: string | null
	prompt: string | null
	error: string | null
}
