import type {
	HudMessage,
	HudMessageNavigationDirection,
} from "./session/reducer"

/** Build the HUD view from the reducer-owned atomic message timeline. */
export function getHudMessages(
	messages: HudMessage[],
	selectedMessageId: string | null,
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

	if (selectedMessage === null) {
		return {
			message: null,
			navigation,
		}
	}

	return {
		message: {
			id: `message:${selectedMessage.id}`,
			content: selectedMessage.text,
			mode: selectedMessage.replyId === null ? ("history" as const) : ("current" as const),
		},
		navigation,
	}
}
