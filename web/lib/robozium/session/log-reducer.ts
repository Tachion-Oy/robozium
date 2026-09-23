import { mapFrameToLogItems, runViewTraceToLogItems } from "../stream"
import { PipeEventType } from "../wire"
import {
	StreamLogItemKind,
	StreamLogRole,
	type MessageLogItem,
} from "../view-model"
import type { LogState, SessionEvent } from "./reducer.types"

function toErrorLogItem(content: string): MessageLogItem {
	return {
		kind: StreamLogItemKind.Message,
		role: StreamLogRole.Error,
		content,
	}
}

export function reduceLogState(log: LogState, event: SessionEvent): LogState {
	if (event.class === "runView" && event.type === "received") {
		if (event.source !== "initial") return log
		return {
			items: runViewTraceToLogItems(event.runView.message_trace),
			minSequence: event.minSequence ?? 0,
		}
	}

	if (
		event.class === "stream" &&
		(event.type === "open_failed" || event.type === "failed")
	) {
		return {
			...log,
			items: [...log.items, toErrorLogItem(event.message)],
		}
	}

	if (event.class === "stream" && event.type === "frame_received") {
		if (
			event.frame.type === PipeEventType.MessageDelta ||
			event.frame.type === PipeEventType.RuntimeEvent
		) {
			return log
		}
		return {
			...log,
			items: [
				...log.items,
				...mapFrameToLogItems(event.frame, event.receivedAt),
			],
		}
	}

	return log
}
