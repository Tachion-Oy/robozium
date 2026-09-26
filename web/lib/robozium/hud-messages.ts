import { streamingDisplayText } from "./streaming-text"
import type { StreamingMessage } from "./stream"
import { RunHudPhase } from "./session/reducer"
import type {
	HudMessage,
	HudMessageNavigationDirection,
} from "./session/reducer"

/** Build the HUD view from the reducer-owned atomic message timeline. */
export function getHudMessages(
	messages: HudMessage[],
	selectedMessageId: string | null,
	live: { phase: RunHudPhase; stream: StreamingMessage | null; prompt: string | null; promptId: string | null },
) {
	const selectedIndex = messages.findIndex(
		(message) => message.id === selectedMessageId,
	)
	const selectedMessage =
		selectedIndex >= 0 ? messages[selectedIndex] : null
	const hasNewerMessage =
		selectedIndex >= 0 && selectedIndex < messages.length - 1
	const firstMessageId = messages[0]?.id ?? null
	const latestMessage = messages.at(-1)
	const latestSelectionId = latestMessage?.replyId ? latestMessage.id : null
	const navigation = {
		enabled: {
			first: firstMessageId !== null && selectedMessageId !== firstMessageId,
			previous:
				selectedIndex > 0 || (selectedIndex < 0 && messages.length > 0),
			next:
				selectedMessage !== null &&
				(hasNewerMessage || selectedMessage.replyId === null),
			latest: messages.length > 0 && selectedMessageId !== latestSelectionId,
		} satisfies Record<HudMessageNavigationDirection, boolean>,
	}

	if (selectedMessage) {
		return {
			message: {
				id: `message:${selectedMessage.id}`,
				content: selectedMessage.text,
				contentType: selectedMessage.contentType,
				mode: selectedMessage.replyId === null ? "history" as const : "current" as const,
			},
			navigation,
		}
	}

	const streaming = live.phase === RunHudPhase.Streaming ? live.stream : null
	return {
		message: {
			id: `live:${streaming?.messageId ?? live.promptId ?? live.phase}`,
			content: streaming
				? streaming.contentType === "markdown" ? streamingDisplayText(streaming.text) : streaming.text
				: live.phase === RunHudPhase.Prompting ? live.prompt ?? "" : "",
			contentType: streaming ? "plain-text" as const : "markdown" as const,
			mode: streaming ? "streaming" as const : "current" as const,
		},
		navigation,
	}
}
