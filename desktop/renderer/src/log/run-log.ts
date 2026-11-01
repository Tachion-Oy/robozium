// Project the displayed run's retained events into message log rows. No log state:
// the log pane computes this only while it is mounted.
import { MessageRole, RunEventType, RunLifecycleKind, type RunRecord } from "../run/run-contracts"
import { isAssistantContent, parseContentObject, type ParsedMessageContent } from "./normalize"
import { StreamLogItemKind, StreamLogRole, type LifecycleLogItem, type MessageLogItem, type StreamLogItem } from "./view-model"

type MessageEvent = Extract<RunRecord, { type: typeof RunEventType.Message }>
type LifecycleEvent = Extract<RunRecord, { type: typeof RunEventType.RunLifecycle }>

const ASSISTANT_KNOWN_KEYS = new Set(["action", "rationale"])

export function stringifyValue(value: unknown): string {
	if (typeof value === "string") return value
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value)
	if (value === null) return "null"
	try {
		return JSON.stringify(value)
	} catch {
		return String(value)
	}
}

function stripKnownKeys(value: Record<string, unknown>, keys: ReadonlySet<string>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.has(key)))
}

const ROLES: Record<MessageRole, StreamLogRole> = {
	[MessageRole.Assistant]: StreamLogRole.Agent,
	[MessageRole.Error]: StreamLogRole.Error,
	[MessageRole.System]: StreamLogRole.System,
	[MessageRole.User]: StreamLogRole.Tool,
}

function parseContent(event: MessageEvent): ParsedMessageContent | undefined {
	switch (event.role) {
		case MessageRole.System:
			return { kind: "system", value: event.content }
		case MessageRole.Error:
			return { kind: "error", value: event.content }
		case MessageRole.Assistant: {
			const parsed = parseContentObject(event.content)
			if (!parsed || !isAssistantContent(parsed)) return undefined
			return { kind: "assistant", action: parsed.action, rationale: parsed.rationale, extra: stripKnownKeys(parsed, ASSISTANT_KNOWN_KEYS) }
		}
		case MessageRole.User: {
			// A tool result names its tool in the message, not in its content.
			const caller = event.caller ?? event.kind
			if (caller === null) return undefined
			return { kind: "user", caller, extra: parseContentObject(event.content) ?? {} }
		}
	}
}

function messageItem(event: MessageEvent): MessageLogItem {
	const parsed = parseContent(event)
	return {
		kind: StreamLogItemKind.Message,
		role: ROLES[event.role],
		content: event.content,
		...(parsed ? { parsed } : {}),
	}
}

/** Started banners omit empty fields; stopped banners show them as null. */
function lifecycleItem(event: LifecycleEvent): LifecycleLogItem {
	const includeNull = event.kind === RunLifecycleKind.Stopped
	const details: Record<string, string> = {}
	for (const [key, value] of Object.entries(event.details)) {
		if (value !== null || includeNull) details[key] = stringifyValue(value)
	}
	const base = { kind: StreamLogItemKind.Lifecycle, role: StreamLogRole.Lifecycle, agentName: event.agent, details } as const
	return event.kind === RunLifecycleKind.Started
		? { ...base, phase: RunLifecycleKind.Started }
		: { ...base, phase: RunLifecycleKind.Stopped, status: event.status }
}

/** Consecutive script output forms one row; a displayed message or banner closes it. */
export function selectLogItems(events: readonly RunRecord[]): StreamLogItem[] {
	const items: StreamLogItem[] = []
	let script: MessageLogItem | null = null
	for (const event of events) {
		switch (event.type) {
			case RunEventType.ScriptOutput:
				if (script) script.content += event.content
				else items.push(script = { kind: StreamLogItemKind.Message, role: StreamLogRole.Script, content: event.content })
				break
			case RunEventType.Message:
				script = null
				items.push(messageItem(event))
				break
			case RunEventType.RunLifecycle:
				script = null
				items.push(lifecycleItem(event))
				break
			case RunEventType.LlmRetry:
				break
		}
	}
	return items
}
