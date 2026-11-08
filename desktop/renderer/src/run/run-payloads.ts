// Validate unknown backend payloads and normalize the run fields consumed by desktop.
// Snapshot history and SSE share the same event decoder; message content stays uninterpreted.
import { z } from "zod"
import { nonBlank, orNull, parsePayload } from "../api/payload"
import {
	LIFECYCLE_DETAIL_KEYS, LifecyclePhase, LifecycleStatus, MessageRole, RunFrameKind, RunStatus, RuntimeLevel, type RunFrame, type RunView,
} from "./run-contracts"

/** The `type` of every SSE frame and snapshot trace entry the backend sends. */
const WireFrameType = {
	Message: "message", MessageDelta: "message_delta", ScriptOutput: "script_output", RunLifecycle: "run_lifecycle", RuntimeEvent: "runtime_event",
} as const
// Runtime events reach the HUD by two rules, the same ones RoboZ's own terminal sink applies:
// every error-level event is a notice, and so is the one informational LLM event the runtime
// addresses to the user, images omitted for a model that cannot read them. An LLM retry becomes a
// control frame. Everything else is ignored.
const LLM_CATEGORY = "llm"
const LlmRuntimeSignal = { Retrying: "retrying", ImagesOmitted: "images_omitted" } as const

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => parsePayload(schema, value, "The backend returned invalid run data.")

const sequence = z.number().int().min(0)
const Envelope = z.object({ type: z.string() })

const MessageEvent = z.object({
	type: z.literal(WireFrameType.Message),
	sequence,
	message_id: orNull(nonBlank),
	payload: z.object({ role: z.enum(MessageRole), content: z.string(), message_kind: orNull(z.string()), caller: orNull(z.string()) }),
}).transform(({ sequence, message_id, payload }) => ({
	type: RunFrameKind.Message, sequence, id: message_id, role: payload.role, content: payload.content, kind: payload.message_kind, caller: payload.caller,
}))

const MessageDeltaEvent = z.object({
	type: z.literal(WireFrameType.MessageDelta),
	sequence,
	payload: z.object({ message_id: nonBlank, delta: z.string(), chunk_index: sequence, agent_name: nonBlank }),
}).transform(({ sequence, payload }) => ({
	type: RunFrameKind.MessageDelta, sequence, id: payload.message_id, delta: payload.delta, chunk: payload.chunk_index, agent: payload.agent_name,
}))

const ScriptOutputEvent = z.object({ type: z.literal(WireFrameType.ScriptOutput), sequence, payload: z.object({ content: z.string() }) })
	.transform(({ sequence, payload }) => ({ type: RunFrameKind.ScriptOutput, sequence, content: payload.content }))

/** Detail fields are display-only scalars; absent fields stay absent. */
const detail = z.union([z.string(), z.number()]).nullable().optional()
const LifecycleDetails = z.object(
	Object.fromEntries(LIFECYCLE_DETAIL_KEYS.map(key => [key, detail])) as Record<typeof LIFECYCLE_DETAIL_KEYS[number], typeof detail>,
)
const RunLifecycleEvent = z.object({
	type: z.literal(WireFrameType.RunLifecycle),
	payload: LifecycleDetails.extend({
		sequence, kind: z.enum(LifecyclePhase), agent_name: z.string(), status: z.enum(LifecycleStatus).nullish(),
	}),
}).transform(({ payload: { sequence, kind, agent_name, ...details } }) => ({
	type: RunFrameKind.Lifecycle, sequence, phase: kind, agent: agent_name, status: details.status ?? null, details,
}))

// The probe reads the routing fields; only a consumed event is validated, and it requires its level.
const RuntimeEvent = z.object({ payload: z.object({ category: z.unknown(), kind: z.unknown(), level: z.unknown().optional() }) })
const LlmRetryEvent = z.object({ sequence, payload: z.object({ agent_name: nonBlank }) })
	.transform(({ sequence, payload }) => ({ type: RunFrameKind.LlmRetry, sequence, agent: payload.agent_name }))
const RuntimeNoticeEvent = z.object({ sequence, payload: z.object({ agent_name: nonBlank, level: z.enum(RuntimeLevel), message: nonBlank }) })
	.transform(({ sequence, payload }) => ({
		type: RunFrameKind.RuntimeNotice, sequence, agent: payload.agent_name, level: payload.level, message: payload.message,
	}))

function isNotice(payload: { category: unknown; kind: unknown; level?: unknown }): boolean {
	return payload.level === RuntimeLevel.Error
		|| (payload.category === LLM_CATEGORY && payload.kind === LlmRuntimeSignal.ImagesOmitted)
}

/** Unconsumed wire frames are ignored; malformed consumed fields are errors. */
export function parseRunEvent(value: unknown): RunFrame | null {
	switch (parse(Envelope, value).type) {
		case WireFrameType.Message: return parse(MessageEvent, value)
		case WireFrameType.MessageDelta: return parse(MessageDeltaEvent, value)
		case WireFrameType.ScriptOutput: return parse(ScriptOutputEvent, value)
		case WireFrameType.RunLifecycle: return parse(RunLifecycleEvent, value)
		case WireFrameType.RuntimeEvent: {
			const { payload } = parse(RuntimeEvent, value)
			if (payload.category === LLM_CATEGORY && payload.kind === LlmRuntimeSignal.Retrying) return parse(LlmRetryEvent, value)
			return isNotice(payload) ? parse(RuntimeNoticeEvent, value) : null
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
