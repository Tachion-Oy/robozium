import type {
	Message,
	PipeEventFrame,
	RunLifecycleEventPayload,
} from "./wire"
import { PipeEventType, RunLifecycleKind, WireRole } from "./wire"
import {
	PROMPT_USER_ACTION,
	StreamLogItemKind,
	StreamLogRole,
	USER_NOTIFICATION_MESSAGE_KIND,
	type LifecycleLogItem,
	type MessageLogItem,
	type StreamLogItem,
	type ContentType,
} from "./view-model"
import {
	zAssistantContentObject,
	zUserContentObject,
	type ParsedMessageContent,
} from "./normalize"

export function stringifyValue(value: unknown): string {
	if (typeof value === "string") return value
	if (
		typeof value === "number" ||
		typeof value === "boolean" ||
		typeof value === "bigint"
	) {
		return String(value)
	}
	if (value === null) return "null"
	try {
		return JSON.stringify(value)
	} catch {
		return String(value)
	}
}

const STARTED_EXCLUDED_LIFECYCLE_DETAIL_KEYS = [
	"kind",
	"output_format",
	"agent_name",
	"sequence",
] as const satisfies readonly (keyof RunLifecycleEventPayload)[]
const STOPPED_EXCLUDED_LIFECYCLE_DETAIL_KEYS = [
	"kind",
	"output_format",
	"agent_name",
	"sequence",
] as const satisfies readonly (keyof RunLifecycleEventPayload)[]

type LifecycleDetailPolicy = {
	excludedKeys: ReadonlySet<keyof RunLifecycleEventPayload>
	includeNullValues: boolean
	detailTimestampKey?: "started_at" | "ended_at"
}

const LIFECYCLE_DETAIL_POLICY: Record<RunLifecycleKind, LifecycleDetailPolicy> =
	{
		[RunLifecycleKind.Started]: {
			excludedKeys: new Set(STARTED_EXCLUDED_LIFECYCLE_DETAIL_KEYS),
			includeNullValues: false,
		},
		[RunLifecycleKind.Stopped]: {
			excludedKeys: new Set(STOPPED_EXCLUDED_LIFECYCLE_DETAIL_KEYS),
			includeNullValues: true,
			detailTimestampKey: "ended_at",
		},
	}

const ASSISTANT_KNOWN_KEYS = ["action", "rationale"] as const
const USER_KNOWN_KEYS = ["caller"] as const

function toLifecycleDetails(
	payload: RunLifecycleEventPayload,
	policy: LifecycleDetailPolicy,
): Record<string, string> {
	const details: Record<string, string> = {}
	for (const rawKey of Object.keys(payload)) {
		const key = rawKey as keyof RunLifecycleEventPayload
		const value = payload[key]
		if (value === undefined) continue
		if (value === null && !policy.includeNullValues) continue
		if (policy.excludedKeys.has(key)) continue
		details[key] = stringifyValue(value)
	}
	return details
}

export function mapRole(role: Message["role"]): StreamLogRole {
	switch (role) {
		case WireRole.Assistant:
			return StreamLogRole.Agent
		case WireRole.Error:
			return StreamLogRole.Error
		case WireRole.System:
			return StreamLogRole.System
		case WireRole.User:
			return StreamLogRole.Tool
		default:
			throw new Error(`Unhandled wire role: ${role}`)
	}
}

function stripKnownKeys(
	value: Record<string, unknown>,
	keys: readonly string[],
): Record<string, unknown> {
	const knownKeys = new Set(keys)
	const out: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(value)) {
		if (!knownKeys.has(k)) {
			out[k] = v
		}
	}
	return out
}

function parseMessage(message: Message): undefined | object {
	let parsed: unknown
	try {
		parsed = JSON.parse(message.content)
	} catch {
		return undefined
	}
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		Array.isArray(parsed)
	) {
		return undefined
	}
	return parsed
}

function parseContentPayload(
	message: Message,
): ParsedMessageContent | undefined {
	switch (message.role) {
		case WireRole.System:
			return {
				kind: "system",
				value: message.content,
			}
		case WireRole.Assistant: {
			const parsed = parseMessage(message)
			if (parsed === undefined) {
				return undefined
			}
			const assistant = zAssistantContentObject.safeParse(parsed)
			if (!assistant.success) return undefined
			return {
				kind: "assistant",
				action: assistant.data.action,
				rationale: assistant.data.rationale,
				extra: stripKnownKeys(assistant.data, ASSISTANT_KNOWN_KEYS),
			}
		}
		case WireRole.User: {
			const parsed = parseMessage(message)
			if (parsed === undefined) {
				if (message.message_kind !== undefined && message.message_kind !== null) {
					return {
						kind: "user",
						caller: message.message_kind,
						extra: {},
					}
				}
				return undefined
			}
			const user = zUserContentObject.safeParse(parsed)
			if (user.success) {
				return {
					kind: "user",
					caller: user.data.caller,
					extra: stripKnownKeys(user.data, USER_KNOWN_KEYS),
				}
			}
			if (message.message_kind !== undefined && message.message_kind !== null) {
				return {
					kind: "user",
					caller: message.message_kind,
					extra: stripKnownKeys(parsed as Record<string, unknown>, USER_KNOWN_KEYS),
				}
			}
			return undefined
		}
		case WireRole.Error: {
			return {
				kind: "error",
				value: message.content,
			}
		}
		default:
			return undefined
	}
}

function messageFrameToItem(
	frame: Extract<PipeEventFrame, { type: `${PipeEventType.Message}` }>,
): MessageLogItem {
	const parsed = parseContentPayload(frame.payload)
	const item: MessageLogItem = {
		kind: StreamLogItemKind.Message,
		role: mapRole(frame.payload.role),
		content: frame.payload.content,
	}
	if (frame.payload.message_kind) {
		item.messageKind = frame.payload.message_kind
	}
	if (parsed) {
		item.parsed = parsed
	}

	if (
		frame.payload.role === WireRole.Assistant &&
		frame.payload.message_kind === USER_NOTIFICATION_MESSAGE_KIND
	) {
		item.hudContent = { text: frame.payload.content, contentType: "markdown" }
		return item
	}
	if (
		parsed?.kind === "assistant" &&
		parsed.action === PROMPT_USER_ACTION &&
		typeof parsed.extra.value === "string"
	) {
		item.hudContent = { text: parsed.extra.value, contentType: "markdown" }
	}

	return item
}

export function scriptOutputToItem(content: string): StreamLogItem {
	return {
		kind: StreamLogItemKind.Message,
		role: StreamLogRole.Script,
		content,
		hudContent: { text: content, contentType: "plain-text" },
	}
}

function lifecycleFrameToItem(
	frame: Extract<PipeEventFrame, { type: `${PipeEventType.RunLifecycle}` }>,
	receivedAt: string,
): LifecycleLogItem {
	const policy = LIFECYCLE_DETAIL_POLICY[frame.payload.kind]
	const details = toLifecycleDetails(frame.payload, policy)
	const lifecycleDetails = policy.detailTimestampKey
		? {
				[policy.detailTimestampKey]: receivedAt,
				...details,
			}
		: details
	const baseLifecycleItem = {
		kind: StreamLogItemKind.Lifecycle as const,
		role: StreamLogRole.Lifecycle as const,
		agentName: frame.payload.agent_name,
		details: lifecycleDetails,
	}

	switch (frame.payload.kind) {
		case RunLifecycleKind.Started:
			return {
				...baseLifecycleItem,
				phase: RunLifecycleKind.Started,
				startedAt: receivedAt,
			}
		case RunLifecycleKind.Stopped: {
			return {
				...baseLifecycleItem,
				phase: RunLifecycleKind.Stopped,
				endedAt: receivedAt,
				status: frame.payload.status,
			}
		}
		default:
			throw new Error(`Unhandled lifecycle kind: ${frame.payload.kind}`)
	}
}

export function mapFrameToLogItem(
	frame: Exclude<
		PipeEventFrame,
		| { type: `${PipeEventType.MessageDelta}` }
		| { type: `${PipeEventType.RuntimeEvent}` }
	>,
	receivedAt: string,
): StreamLogItem {
	switch (frame.type) {
		case PipeEventType.RunLifecycle:
			return lifecycleFrameToItem(frame, receivedAt)
		case PipeEventType.Message:
			return messageFrameToItem(frame)
		case PipeEventType.ScriptOutput:
			return scriptOutputToItem(frame.payload.content)
		default:
			throw new Error(`Unhandled frame type: ${JSON.stringify(frame)}`)
	}
}

/** Raw accumulated content; identity never determines its presentation. */
export type StreamingMessage = {
	messageId: string
	chunkIndex: number
	text: string
	agentName: string | null
	role: StreamLogRole
	contentType: ContentType
}

export type StreamingDelta = StreamingMessage

export function accumulateStreamingDelta(
	prev: StreamingMessage | null,
	delta: StreamingDelta,
): StreamingMessage {
	return {
		...delta,
		text: prev?.messageId === delta.messageId && prev.role === delta.role
			? prev.text + delta.text
			: delta.text,
	}
}

export function getFrameSequence(frame: PipeEventFrame): number {
	switch (frame.type) {
		case PipeEventType.Message:
			return frame.sequence
		case PipeEventType.RunLifecycle:
			return frame.payload.sequence
		case PipeEventType.ScriptOutput:
			return frame.sequence
		case PipeEventType.MessageDelta:
			return frame.sequence
		case PipeEventType.RuntimeEvent:
			return frame.sequence
	}
}
