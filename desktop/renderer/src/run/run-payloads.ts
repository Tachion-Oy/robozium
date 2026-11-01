// Validate unknown backend payloads and normalize the run fields consumed by desktop.
// Snapshot history and SSE share the same event decoder; message content stays uninterpreted.
import { z } from "zod"
import { nonBlank, orNull, parsePayload } from "../api/client"
import {
	LIFECYCLE_DETAIL_KEYS, LifecycleStatus, MessageRole, RunEventType, RunLifecycleKind, RunStatus, RuntimeEventCategory, RuntimeEventKind,
	type RunFrame, type RunView,
} from "./run-contracts"

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => parsePayload(schema, value, "The backend returned invalid run data.")

const sequence = z.number().int().min(0)
const Envelope = z.object({ type: z.string() })

const MessageEvent = z.object({
	type: z.literal(RunEventType.Message),
	sequence,
	message_id: orNull(nonBlank),
	payload: z.object({ role: z.enum(MessageRole), content: z.string(), message_kind: orNull(z.string()), caller: orNull(z.string()) }),
}).transform(({ type, sequence, message_id, payload }) => ({
	type, sequence, id: message_id, role: payload.role, content: payload.content, kind: payload.message_kind, caller: payload.caller,
}))

const MessageDeltaEvent = z.object({
	type: z.literal(RunEventType.MessageDelta),
	sequence,
	payload: z.object({ message_id: nonBlank, delta: z.string(), chunk_index: sequence, agent_name: nonBlank }),
}).transform(({ type, sequence, payload }) => ({
	type, sequence, id: payload.message_id, delta: payload.delta, chunk: payload.chunk_index, agent: payload.agent_name,
}))

const ScriptOutputEvent = z.object({ type: z.literal(RunEventType.ScriptOutput), sequence, payload: z.object({ content: z.string() }) })
	.transform(({ type, sequence, payload }) => ({ type, sequence, content: payload.content }))

/** Detail fields are display-only scalars; absent fields stay absent. */
const detail = z.union([z.string(), z.number()]).nullable().optional()
const LifecycleDetails = z.object(
	Object.fromEntries(LIFECYCLE_DETAIL_KEYS.map(key => [key, detail])) as Record<typeof LIFECYCLE_DETAIL_KEYS[number], typeof detail>,
)
const RunLifecycleEvent = z.object({
	type: z.literal(RunEventType.RunLifecycle),
	payload: LifecycleDetails.extend({
		sequence, kind: z.enum(RunLifecycleKind), agent_name: z.string(), status: z.enum(LifecycleStatus).nullish(),
	}),
}).transform(({ type, payload: { sequence, kind, agent_name, ...details } }) => ({
	type, sequence, kind, agent: agent_name, status: details.status ?? null, details,
}))

const RuntimeEvent = z.object({ payload: z.object({ category: z.unknown(), kind: z.unknown() }) })
const LlmRetryEvent = z.object({ sequence, payload: z.object({ agent_name: nonBlank }) })
	.transform(({ sequence, payload }) => ({ type: RunEventType.LlmRetry, sequence, agent: payload.agent_name }))

/** Unconsumed event kinds are ignored; malformed consumed fields are errors. */
export function parseRunEvent(value: unknown): RunFrame | null {
	switch (parse(Envelope, value).type) {
		case RunEventType.Message: return parse(MessageEvent, value)
		case RunEventType.MessageDelta: return parse(MessageDeltaEvent, value)
		case RunEventType.ScriptOutput: return parse(ScriptOutputEvent, value)
		case RunEventType.RunLifecycle: return parse(RunLifecycleEvent, value)
		case RunEventType.RuntimeEvent: {
			const { payload } = parse(RuntimeEvent, value)
			if (payload.category !== RuntimeEventCategory.Llm || payload.kind !== RuntimeEventKind.Retrying) return null
			return parse(LlmRetryEvent, value)
		}
		default:
			return null
	}
}

const CreatedRun = z.object({ run_id: nonBlank })

export function parseCreatedRunId(value: unknown): string {
	return parse(CreatedRun, value).run_id
}

const RunSnapshot = z.object({
	project: nonBlank,
	status: z.enum(RunStatus),
	message_trace: z.array(z.unknown()),
	current_prompt_id: z.string().nullable(),
	current_prompt: z.string().nullable(),
	error: z.string().nullable(),
}).refine(({ current_prompt_id: promptId, current_prompt: prompt }) => (promptId === null) === (prompt === null) && promptId !== "")

export function parseRunSnapshot(value: unknown): RunView {
	const snapshot = parse(RunSnapshot, value)
	const frames: RunFrame[] = []
	for (const event of snapshot.message_trace) {
		const frame = parseRunEvent(event)
		if (frame) frames.push(frame)
	}
	return {
		project: snapshot.project,
		status: snapshot.status,
		frames,
		promptId: snapshot.current_prompt_id,
		prompt: snapshot.current_prompt,
		error: snapshot.error,
	}
}
