// Validate unknown backend payloads and normalize the run fields consumed by desktop.
// Snapshot history and SSE share the same event decoder; message content stays uninterpreted.
import { ApiError } from "../api/client"
import {
	LIFECYCLE_DETAIL_KEYS, LifecycleStatus, MessageRole, RunEventType, RunLifecycleKind, RunStatus, RuntimeEventCategory, RuntimeEventKind,
	type LifecycleDetails, type RunFrame, type RunView,
} from "./run-contracts"

function malformed(): never {
	throw new ApiError("malformed", "The backend returned invalid run data.")
}

function readObject(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) malformed()
	return value as Record<string, unknown>
}

function readString(value: unknown): string {
	if (typeof value !== "string") malformed()
	return value
}

function readIdentifier(value: unknown): string {
	const text = readString(value)
	if (!text.trim()) malformed()
	return text
}

function readNullableString(value: unknown): string | null {
	return value === null ? null : readString(value)
}

function readSequence(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) malformed()
	return value
}

function readMember<T extends string>(value: unknown, values: readonly T[]): T {
	const member = values.find(candidate => candidate === value)
	if (member === undefined) malformed()
	return member
}

/** Detail fields are display-only scalars; absent fields stay absent. */
function readLifecycleDetails(payload: Record<string, unknown>): LifecycleDetails {
	const details: Record<string, string | number | null> = {}
	for (const key of LIFECYCLE_DETAIL_KEYS) {
		const value = payload[key]
		if (value === undefined) continue
		if (value !== null && typeof value !== "string" && typeof value !== "number") malformed()
		details[key] = value
	}
	return details
}

/** Unconsumed event kinds are ignored; malformed consumed fields are errors. */
export function parseRunEvent(value: unknown): RunFrame | null {
	const event = readObject(value)
	const type = readString(event.type)
	switch (type) {
		case RunEventType.Message: {
			const payload = readObject(event.payload)
			return {
				type,
				sequence: readSequence(event.sequence),
				id: event.message_id == null ? null : readIdentifier(event.message_id),
				role: readMember(payload.role, Object.values(MessageRole)),
				content: readString(payload.content),
				kind: payload.message_kind == null ? null : readString(payload.message_kind),
			}
		}
		case RunEventType.MessageDelta: {
			const payload = readObject(event.payload)
			return {
				type,
				sequence: readSequence(event.sequence),
				id: readIdentifier(payload.message_id),
				delta: readString(payload.delta),
				chunk: readSequence(payload.chunk_index),
				agent: readIdentifier(payload.agent_name),
			}
		}
		case RunEventType.ScriptOutput:
			return { type, sequence: readSequence(event.sequence), content: readString(readObject(event.payload).content) }
		case RunEventType.RunLifecycle: {
			const payload = readObject(event.payload)
			return {
				type,
				sequence: readSequence(payload.sequence),
				kind: readMember(payload.kind, Object.values(RunLifecycleKind)),
				agent: readString(payload.agent_name),
				status: payload.status == null ? null : readMember(payload.status, Object.values(LifecycleStatus)),
				details: readLifecycleDetails(payload),
			}
		}
		case RunEventType.RuntimeEvent: {
			const payload = readObject(event.payload)
			if (payload.category !== RuntimeEventCategory.Llm) return null
			if (payload.kind === RuntimeEventKind.Retrying) {
				return {
					type: RunEventType.LlmRetry,
					sequence: readSequence(event.sequence),
					agent: readIdentifier(payload.agent_name),
				}
			}
			if (payload.kind !== RuntimeEventKind.ImagesOmitted || payload.level !== "info") return null
			// A model name alone is ambiguous across providers, so name it only with its endpoint.
			const data = payload.data == null ? {} : readObject(payload.data)
			return {
				type: RunEventType.ImagesOmitted,
				sequence: readSequence(event.sequence),
				message: readString(payload.message),
				model: typeof data.endpoint === "string" && typeof data.model === "string" ? `${data.endpoint}/${data.model}` : null,
			}
		}
		default:
			return null
	}
}

export function parseCreatedRunId(value: unknown): string {
	return readIdentifier(readObject(value).run_id)
}

export function parseRunSnapshot(value: unknown): RunView {
	const snapshot = readObject(value)
	const status = readMember(snapshot.status, Object.values(RunStatus))
	if (!Array.isArray(snapshot.message_trace)) malformed()
	const promptId = readNullableString(snapshot.current_prompt_id)
	const prompt = readNullableString(snapshot.current_prompt)
	if ((promptId === null) !== (prompt === null) || promptId === "") malformed()
	const frames: RunFrame[] = []
	for (const value of snapshot.message_trace) {
		const event = parseRunEvent(value)
		if (event) frames.push(event)
	}
	return {
		project: readIdentifier(snapshot.project),
		status,
		frames,
		promptId,
		prompt,
		error: readNullableString(snapshot.error),
	}
}
