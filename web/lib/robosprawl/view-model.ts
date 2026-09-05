import { type LifecycleStatus, RunLifecycleKind } from "./wire"
import type { ParsedMessageContent } from "./normalize"

/** UI stream item role understood by terminal message rows. */
export enum StreamLogRole {
	Agent = "agent",
	Tool = "tool",
	Script = "script",
	Error = "error",
	System = "system",
	Lifecycle = "lifecycle",
}

/**
 * Log row role → prompt caret (system collapses to agent; same as
 * `data-term-role` on `.term-caret` in `app/globals.css`).
 */
export const logRoleToCaret: Record<
	StreamLogRole,
	"agent" | "tool" | "error"
> = {
	[StreamLogRole.Agent]: "agent",
	[StreamLogRole.System]: "agent",
	[StreamLogRole.Lifecycle]: "agent",
	[StreamLogRole.Tool]: "tool",
	[StreamLogRole.Script]: "tool",
	[StreamLogRole.Error]: "error",
}

/** Left-gutter badge text in `TerminalMessage` (uppercase role tag). */
export const logRoleToRowLabel: Record<StreamLogRole, string> = {
	[StreamLogRole.Agent]: "AGENT",
	[StreamLogRole.Tool]: "TOOL",
	[StreamLogRole.Script]: "SCRIPT",
	[StreamLogRole.Error]: "ERROR",
	[StreamLogRole.System]: "SYSTEM",
	[StreamLogRole.Lifecycle]: "LIFECYCLE",
}

export enum StreamLogItemKind {
	Message = "message",
	Lifecycle = "lifecycle",
}

export type LifecycleStartedLogItem = {
	kind: StreamLogItemKind.Lifecycle
	role: StreamLogRole.Lifecycle
	phase: `${RunLifecycleKind.Started}`
	agentName: string
	startedAt: string
	/** API lifecycle payload entries rendered in the process banner. */
	details: Record<string, string>
}

export type LifecycleStoppedLogItem = {
	kind: StreamLogItemKind.Lifecycle
	role: StreamLogRole.Lifecycle
	phase: `${RunLifecycleKind.Stopped}`
	agentName: string
	endedAt: string
	status: LifecycleStatus | null
	/** API lifecycle payload entries rendered in the process banner. */
	details: Record<string, string>
}

/** One message row in the terminal log. */
export type MessageLogItem = {
	kind: StreamLogItemKind.Message
	role: StreamLogRole
	content: string
	hudText?: string
	label?: string
	parsed?: ParsedMessageContent
	messageKind?: string
}

export const PROMPT_USER_ACTION = "prompt_user" as const
export const USER_NOTIFICATION_MESSAGE_KIND = "user_notification" as const

export function isPromptUserAssistantMessage(item: MessageLogItem): boolean {
	return (
		item.parsed?.kind === "assistant" &&
		item.parsed.action === PROMPT_USER_ACTION
	)
}

export type LifecycleLogItem = LifecycleStartedLogItem | LifecycleStoppedLogItem

/** Discriminated union for all items shown in the terminal log. */
export type StreamLogItem = LifecycleLogItem | MessageLogItem
