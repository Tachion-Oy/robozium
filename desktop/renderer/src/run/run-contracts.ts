// Run vocabulary shared by payload validation, reconciliation and HUD consumers: the desktop's
// frame kinds and the complete value sets the backend uses for roles, phases and statuses.
// A value that one module alone reacts to lives in that module (run-payloads, hud-messages).

/** Discriminant of RunFrame. The parser maps wire frames to these kinds; the last two have no wire frame of their own. */
export const RunFrameKind = {
	Message: "message",
	MessageDelta: "message_delta",
	ScriptOutput: "script_output",
	Lifecycle: "run_lifecycle",
	// Control frames the parser derives from LLM runtime events.
	LlmRetry: "llm_retry",
	ImagesOmitted: "images_omitted",
} as const

export const MessageRole = {
	Assistant: "assistant", User: "user", System: "system", Error: "error",
} as const
export type MessageRole = typeof MessageRole[keyof typeof MessageRole]

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
	/** The model cannot read the conversation's images; the runtime's message says so. */
	| { type: typeof RunFrameKind.ImagesOmitted; agent: string; message: string }
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
