// Run protocol values and types shared by payload validation, reconciliation and HUD consumers.
// Consumed subset of web/lib/robozium/wire.ts at 673d361; no browser dependencies.
export const RunEventType = {
	Message: "message",
	MessageDelta: "message_delta",
	ScriptOutput: "script_output",
	RunLifecycle: "run_lifecycle",
	RuntimeEvent: "runtime_event",
	// Desktop control event normalized from an LLM retry runtime event.
	LlmRetry: "llm_retry",
} as const

export const MessageRole = {
	Assistant: "assistant", User: "user", System: "system", Error: "error",
} as const
export type MessageRole = typeof MessageRole[keyof typeof MessageRole]

export const RuntimeEventCategory = { Llm: "llm" } as const
export const RuntimeEventKind = { Retrying: "retrying" } as const
export const MessageKind = { UserNotification: "user_notification" } as const
export const AgentAction = { PromptUser: "prompt_user" } as const

export const RunLifecycleKind = { Started: "started", Stopped: "stopped" } as const
export type RunLifecycleKind = typeof RunLifecycleKind[keyof typeof RunLifecycleKind]
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
	| { type: typeof RunEventType.Message; id: string | null; role: MessageRole; content: string; kind: string | null }
	| { type: typeof RunEventType.MessageDelta; id: string; delta: string; chunk: number; agent: string }
	| { type: typeof RunEventType.LlmRetry; agent: string }
	| { type: typeof RunEventType.ScriptOutput; content: string }
	| {
		type: typeof RunEventType.RunLifecycle
		kind: RunLifecycleKind
		agent: string
		status: LifecycleStatus | null
		details: LifecycleDetails
	}
)
export type RunDelta = Extract<RunFrame, { type: typeof RunEventType.MessageDelta }>
export type RunRecord = Exclude<RunFrame, RunDelta>
export interface RunView {
	project: string
	status: RunStatus
	frames: RunFrame[]
	promptId: string | null
	prompt: string | null
	error: string | null
}
