import { z } from "zod"

/**
 * API/SSE wire contracts: exact transport payloads as received over HTTP/SSE.
 */

/** `roboz.models.Role` (StrEnum, lowercase on the wire). */
export enum WireRole {
	System = "system",
	Assistant = "assistant",
	User = "user",
	Error = "error",
}
export type Role = `${WireRole}`

export enum PipeEventType {
	Message = "message",
	RunLifecycle = "run_lifecycle",
	ScriptOutput = "script_output",
	MessageDelta = "message_delta",
	RuntimeEvent = "runtime_event",
}

export enum WireLifecycleStatus {
	Running = "running",
	Completed = "completed",
	Failed = "failed",
	Cancelled = "cancelled",
}

export enum WireRunStatus {
	Queued = "queued",
	Running = "running",
	AwaitingUserInput = "awaiting_user_input",
	Cancelling = "cancelling",
	Completed = "completed",
	Failed = "failed",
	Cancelled = "cancelled",
}

export enum WireRuntimeEventCategory {
	Llm = "llm",
	Tool = "tool",
}

export enum WireRuntimeEventKind {
	Started = "started",
	Retrying = "retrying",
	Succeeded = "succeeded",
	Failed = "failed",
	TimedOut = "timed_out",
	Cancelled = "cancelled",
	Interrupted = "interrupted",
}

export const zLifecycleStatus = z.enum(WireLifecycleStatus)
export const zRunStatus = z.enum(WireRunStatus)

export enum RunLifecycleKind {
	Started = "started",
	Stopped = "stopped",
}

/** `roboz.models.Message` — `truncation` is opaque until we render it. */
export const zWireMessagePayload = z
	.object({
		role: z.enum(WireRole),
		content: z.string(),
		truncation: z.unknown(),
		message_kind: z.string().nullish(),
		endpoint: z.string().nullish(),
		model: z.string().nullish(),
		token_input: z.number().int().nullish(),
		token_output: z.number().int().nullish(),
	})
	.refine(
		(obj) => Object.prototype.hasOwnProperty.call(obj, "truncation"),
		{ message: "truncation is required" },
	)
export type Message = z.infer<typeof zWireMessagePayload>

/** HTTP run status from `robozium.api.state`. */
export type RunStatus = `${WireRunStatus}`

/** Pipe lifecycle status from `roboz.runtime.persistence.schema`. */
export type LifecycleStatus = `${WireLifecycleStatus}`

export type RunView = {
	capabilities: CapabilitySelection
	project: string
	status: RunStatus
	current_agent_name: string | null
	parent_agent_name: string | null
	message_trace: PipeEventFrame[]
	current_prompt_id: string | null
	current_prompt: string | null
	error: string | null
}

export type ProjectStatus =
	| "running"
	| "awaiting_user_input"
	| "cancelling"
	| "syncing"
	| "dormant"
export type Project = {
	slug: string
	status: ProjectStatus
	run_id: string | null
	created_at: number | null
}
export type ProjectSlug = string
export type ProjectCreateBody = { name: string }
export type ProjectCreateResponse = { slug: ProjectSlug }
export type SkillLoading = "automatic" | "on_demand"
export type CapabilitySelection = Record<string, boolean | SkillLoading>
export type CapabilityView = {
	name: string
	kind: "tool" | "skill"
	selectable: boolean
	loading: SkillLoading | null
}
export type CreateBody = {
	project: ProjectSlug
	capabilities?: CapabilitySelection | null
}
export type CreateResponse = { run_id: string }

export type ReplyBody = { prompt_id?: string | null; content: string }
export type ReplyResponse = { ok: boolean }

export type CancelResponse = { ok: boolean }
export type DeleteProjectResponse = { ok: boolean }
export type TranscribeResponse = { text: string }
export type CredentialStatus = {
	available: boolean
	locked: boolean
	removable: boolean
}
export type CredentialUnlockBody = { password: string }

export type AvailableModel = {
	model_id: string
	label: string
}
export type ModelSelection = {
	models: AvailableModel[]
	selected_model_id: string
}
export type ModelSelectBody = { model_id: string; run_id?: string }

export type DependencyStatus = "pending" | "available" | "unavailable"
export type DependencyKind =
	| "executable"
	| "network_service"
	| "model_endpoint"
export type DependencyReasonCode =
	| "not_found"
	| "missing_credentials"
	| "authentication_failed"
	| "connection_failed"
	| "tls_failed"
	| "timeout"
	| "protocol_error"
	| "model_unavailable"
	| "check_failed"

export type DependencyRecord = {
	dependency_id: string
	kind: DependencyKind
	redacted_metadata: Record<string, string>
	status: DependencyStatus
	checked_at: string | null
	latency_ms: number | null
	reason_code: DependencyReasonCode | null
}

export const zMessageEventFrame = z.object({
	type: z.literal(PipeEventType.Message),
	sequence: z.number().int(),
	message_id: z.string().nullish(),
	payload: zWireMessagePayload,
})
export type MessageEventFrame = z.infer<typeof zMessageEventFrame>

/**
 * Mirrors `roboz.runtime.events.RunLifecycleEvent` on the wire.
 * Newer servers emit full `asdict()`; older payloads may only include
 * `kind`, `agent_name`, `status`.
 */
export const zRunLifecycleEventPayload = z.object({
	kind: z.enum(RunLifecycleKind),
	agent_name: z.string(),
	parent_agent_name: z.string().nullish(),
	sequence: z.number().int(),
	status: zLifecycleStatus.nullish().transform((v) => v ?? null),
	api_name: z.string().nullish(),
	model_name: z.string().nullish(),
	max_context_tokens: z.number().int().nullish(),
	temperature: z.number().nullish(),
	output_format: z.enum(["text", "json"]).nullish(),
})
export type RunLifecycleEventPayload = z.infer<typeof zRunLifecycleEventPayload>

export const zRunLifecycleEventFrame = z.object({
	type: z.literal(PipeEventType.RunLifecycle),
	payload: zRunLifecycleEventPayload,
})
export type RunLifecycleEventFrame = z.infer<typeof zRunLifecycleEventFrame>

export const zScriptOutputEventFrame = z.object({
	type: z.literal(PipeEventType.ScriptOutput),
	sequence: z.number().int(),
	payload: z.object({
		content: z.string(),
	}),
})
export type ScriptOutputEventFrame = z.infer<typeof zScriptOutputEventFrame>

export const zMessageDeltaEventFrame = z.object({
	type: z.literal(PipeEventType.MessageDelta),
	sequence: z.number().int(),
	payload: z.object({
		message_id: z.string(),
		delta: z.string(),
		chunk_index: z.number().int(),
		role: z.enum(WireRole),
		agent_name: z.string(),
		sequence: z.number().int(),
	}),
})
export type MessageDeltaEventFrame = z.infer<typeof zMessageDeltaEventFrame>

export const zRuntimeEventFrame = z.object({
	type: z.literal(PipeEventType.RuntimeEvent),
	sequence: z.number().int(),
	payload: z.object({
		category: z.string(),
		kind: z.string(),
		level: z.enum(["debug", "info", "warning", "error"]),
		message: z.string(),
		agent_name: z.string(),
		data: z.record(z.string(), z.unknown()).nullable().optional(),
	}),
})
export type RuntimeEventFrame = z.infer<typeof zRuntimeEventFrame>

/**
 * Discriminated union of the frames we surface to consumers. The server may
 * emit other `type` values (e.g. a forward-compat `"unknown"` branch); those
 * are dropped at decode time rather than leaked into the public type.
 */
export type PipeEventFrame =
	| MessageEventFrame
	| RunLifecycleEventFrame
	| ScriptOutputEventFrame
	| MessageDeltaEventFrame
	| RuntimeEventFrame
export const zPipeEventFrame = z.discriminatedUnion("type", [
	zMessageEventFrame,
	zRunLifecycleEventFrame,
	zScriptOutputEventFrame,
	zMessageDeltaEventFrame,
	zRuntimeEventFrame,
])
