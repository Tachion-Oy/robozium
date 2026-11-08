// Run vocabulary shared by payload validation, reconciliation and HUD consumers: the desktop's
// frame kinds and the complete value sets the backend uses for roles, phases and statuses.
// A value that one module alone reacts to lives in that module (run-payloads, hud-messages).

/** Discriminant of RunFrame. The parser maps wire frames to these kinds; the last two have no wire frame of their own. */
export const RunFrameKind = {
	Message: "message",
	MessageDelta: "message_delta",
	ScriptOutput: "script_output",
	Lifecycle: "run_lifecycle",
	// Frames the parser derives from runtime events: a model retry, and a notice the user should see.
	LlmRetry: "llm_retry",
	RuntimeNotice: "runtime_notice",
} as const

export const MessageRole = {
	Assistant: "assistant", User: "user", System: "system", Error: "error",
} as const
export type MessageRole = typeof MessageRole[keyof typeof MessageRole]

/** Severity the runtime attaches to each of its events. */
export const RuntimeLevel = { Debug: "debug", Info: "info", Warning: "warning", Error: "error" } as const
export type RuntimeLevel = typeof RuntimeLevel[keyof typeof RuntimeLevel]

export const LifecyclePhase = { Started: "started", Stopped: "stopped" } as const
export type LifecyclePhase = typeof LifecyclePhase[keyof typeof LifecyclePhase]
export const LifecycleStatus = {
	Running: "running", Completed: "completed", Failed: "failed", Cancelled: "cancelled",
} as const
export type LifecycleStatus = typeof LifecycleStatus[keyof typeof LifecycleStatus]
/** Lifecycle payload fields shown in the message log banner, in wire order. */
export const LIFECYCLE_DETAIL_KEYS = [
	"parent_agent_name", "status", "api_name", "model_name", "max_context_tokens", "temperature",
] as const
export type LifecycleDetails = Readonly<Partial<Record<typeof LIFECYCLE_DETAIL_KEYS[number], string | number | null>>>

export const RunStatus = {
	Queued: "queued",
	Running: "running",
	AwaitingUserInput: "awaiting_user_input",
	Cancelling: "cancelling",
	Completed: "completed",
	Failed: "failed",
	Cancelled: "cancelled",
} as const
export type RunStatus = typeof RunStatus[keyof typeof RunStatus]

export function isTerminal(status: RunStatus): boolean {
	return status === RunStatus.Completed || status === RunStatus.Failed || status === RunStatus.Cancelled
}

export type RunFrame = { sequence: number } & (
	| { type: typeof RunFrameKind.Message; id: string | null; role: MessageRole; content: string; kind: string | null; caller: string | null }
	| { type: typeof RunFrameKind.MessageDelta; id: string; delta: string; chunk: number; agent: string }
	| { type: typeof RunFrameKind.LlmRetry; agent: string }
	/** A runtime event meant for the user, shown as the runtime wrote it. */
	| { type: typeof RunFrameKind.RuntimeNotice; agent: string; level: RuntimeLevel; message: string }
	| { type: typeof RunFrameKind.ScriptOutput; content: string }
	| {
		type: typeof RunFrameKind.Lifecycle
		phase: LifecyclePhase
		agent: string
		status: LifecycleStatus | null
		details: LifecycleDetails
	}
)
export type RunDelta = Extract<RunFrame, { type: typeof RunFrameKind.MessageDelta }>
export type RunRecord = Exclude<RunFrame, RunDelta>
export interface RunView {
	project: string
	status: RunStatus
	frames: RunFrame[]
	promptId: string | null
	prompt: string | null
	error: string | null
}
