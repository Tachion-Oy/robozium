import { StreamLogItemKind, StreamLogRole } from "../view-model"
import type { LogState, PresentationEvent } from "./reducer.types"

export function reduceLogState(log: LogState, event: PresentationEvent): LogState {
	if (event.class === "content" && event.type === "completed" && event.item) {
		return { ...log, items: [...log.items, event.item] }
	}
	if (event.class === "stream" && (event.type === "open_failed" || event.type === "failed")) {
		return {
			...log,
			items: [...log.items, {
				kind: StreamLogItemKind.Message,
				role: StreamLogRole.Error,
				content: event.message,
				contentType: "markdown",
			}],
		}
	}
	return log
}
