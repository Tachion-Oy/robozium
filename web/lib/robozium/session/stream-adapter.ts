import { getFrameSequence, mapFrameToLogItems, mapRole, scriptOutputToItem } from "../stream"
import { StreamLogRole } from "../view-model"
import { PipeEventType } from "../wire"
import { reduceHudState } from "./hud-reducer"
import { reduceLogState } from "./log-reducer"
import { reduceNotifications } from "./notification-reducer"
import type { ContentEvent, PresentationEvent, RunSessionState, SessionEvent } from "./reducer.types"

const terminalStatuses = new Set(["completed", "failed", "cancelled"])

/** Translate wire input once. Only this boundary knows about script grouping. */
function adapt(
	hud: RunSessionState["hud"],
	event: SessionEvent,
	source: "live" | "snapshot",
): PresentationEvent[] {
	const active = hud.streaming
	const script = active?.role === StreamLogRole.Script ? active : null
	const complete = (): ContentEvent[] => script ? [{
		class: "content",
		type: "completed",
		messageId: script.messageId,
		item: scriptOutputToItem(script.text),
	}] : []

	if (event.class === "control") return event.type === "reply_submitted" ? [...complete(), event] : [event]
	if (event.class === "runView") {
		const view = event.runView
		const newPrompt = view.current_prompt_id !== null && view.current_prompt_id !== hud.promptId &&
			view.current_prompt_id !== hud.dismissedPromptId
		return newPrompt || terminalStatuses.has(view.status) ? [...complete(), event] : [event]
	}
	if (event.type !== "frame_received") return [event]
	const frame = event.frame
	switch (frame.type) {
		case PipeEventType.ScriptOutput:
			return [{
				class: "content",
				type: "delta",
				delta: {
					messageId: script?.messageId ?? `script:${frame.sequence}`,
					chunkIndex: script ? script.chunkIndex + 1 : 0,
					agentName: script ? script.agentName : hud.currentAgentName,
					role: StreamLogRole.Script,
					contentType: "plain-text",
					text: frame.payload.content,
				},
			}]
		case PipeEventType.MessageDelta:
			// Initial snapshots retain script boundaries without restoring LLM tokens.
			return source === "snapshot" ? complete() : [...complete(), {
				class: "content",
				type: "delta",
				delta: {
					messageId: frame.payload.message_id,
					chunkIndex: frame.payload.chunk_index,
					agentName: frame.payload.agent_name,
					role: mapRole(frame.payload.role),
					contentType: "markdown",
					text: frame.payload.delta,
				},
			}]
		case PipeEventType.Message:
		case PipeEventType.RunLifecycle:
			return [...complete(), {
				class: "content", type: "completed",
				messageId: frame.type === PipeEventType.Message ? frame.message_id ?? null :
					frame.payload.kind === "stopped" ? active?.messageId ?? null : null,
				item: mapFrameToLogItems(frame, event.receivedAt)[0] ?? null,
			}, ...(frame.type === PipeEventType.RunLifecycle ? [{ ...event, frame }] : [])]
		case PipeEventType.RuntimeEvent:
			return frame.payload.category === "llm" && frame.payload.kind === "retrying" &&
				(active ?? hud.lastStreaming)?.role !== StreamLogRole.Script
				? [{ class: "content", type: "reset" }, { ...event, frame }] : [{ ...event, frame }]
	}
}

/** Every live and recovered input follows this same transition. */
export function reduceSessionEvent(state: RunSessionState, event: SessionEvent): RunSessionState {
	const initial = event.class === "runView" && event.source === "initial" && state.hud.status === null
	const inputs: SessionEvent[] = event.class === "runView" ? [
		...[...event.runView.message_trace].sort((a, b) => getFrameSequence(a) - getFrameSequence(b)).map(
			(frame): SessionEvent => ({ class: "stream", type: "frame_received", frame, receivedAt: new Date().toISOString() }),
		),
		{ ...event, source: initial ? "initial" : "poll" },
	] : [event]

	for (const input of inputs) {
		const sequence = input.class === "stream" && input.type === "frame_received" ? getFrameSequence(input.frame) : null
		if (sequence !== null && sequence <= state.log.minSequence) continue
		for (const internal of adapt(state.hud, input, initial ? "snapshot" : "live")) {
			const log = reduceLogState(state.log, internal)
			state = {
					...state,
					log,
				hud: reduceHudState(state.hud, internal, log.items, state.log.items.length),
				notifications: internal.class === "content" ? state.notifications :
					reduceNotifications(state.notifications, state.runId, internal),
			}
		}
		if (sequence !== null) state = { ...state, log: { ...state.log, minSequence: sequence } }
	}
	if (event.class !== "runView") return state
	return {
		...state,
		projectSlug: event.runView.project,
		log: { ...state.log, minSequence: Math.max(state.log.minSequence, event.minSequence ?? 0) },
	}
}
