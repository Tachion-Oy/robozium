import { PipeEventType, type PipeEventFrame } from "../wire"
import type { RuntimeErrorNotification, SessionEvent } from "./reducer.types"

function runtimeNotificationFromFrame(
	runId: string,
	frame: PipeEventFrame,
): RuntimeErrorNotification | null {
	if (frame.type !== PipeEventType.RuntimeEvent) return null
	if (frame.payload.level !== "warning" && frame.payload.level !== "error") {
		return null
	}
	return {
		id: `${runId}:${frame.sequence}`,
		category: frame.payload.category,
		kind: frame.payload.kind,
		level: frame.payload.level,
		message: frame.payload.message,
		agentName: frame.payload.agent_name,
		data: frame.payload.data ?? null,
	}
}

function transportNotification(
	runId: string,
	event: SessionEvent,
): RuntimeErrorNotification | null {
	if (event.class !== "stream") return null
	if (event.type !== "open_failed" && event.type !== "failed") return null
	return {
		id: `${runId}:stream:${event.type}:${event.message}`,
		category: "stream",
		kind: event.type,
		level: "error",
		message: event.message,
		agentName: "system",
		data: null,
	}
}

export function reduceNotifications(
	notifications: RuntimeErrorNotification[],
	runId: string,
	event: SessionEvent,
): RuntimeErrorNotification[] {
	switch (event.class) {
		case "runView":
			return event.source === "initial" ? [] : notifications
		case "control":
			return notifications
		case "stream": {
			if (event.type === "frame_received") {
				const notification = runtimeNotificationFromFrame(runId, event.frame)
				return notification === null
					? notifications
					: [...notifications, notification]
			}
			const notification = transportNotification(runId, event)
			return notification === null
				? notifications
				: [...notifications, notification]
		}
	}
}
