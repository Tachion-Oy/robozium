import { accumulateStreamingDelta, type StreamingMessage } from "../stream"
import type { RunStatus, RunView } from "../wire"
import { StreamLogItemKind, type StreamLogItem } from "../view-model"
import { RunHudPhase } from "./reducer.types"
import type {
	ControlEvent,
	HudMessage,
	HudMessageNavigationDirection,
	HudState,
	ContentEvent,
	RunViewEvent,
	SessionEvent,
} from "./reducer.types"

const TERMINAL_STATUSES = new Set<RunStatus>([
	"completed",
	"failed",
	"cancelled",
])

export function getActiveStreamingMessageFromHud(
	hud: HudState,
): StreamingMessage | null {
	if (hud.streaming) return hud.streaming
	return hud.isSettling ? hud.lastStreaming : null
}

function hasPrompt(hud: HudState): boolean {
	if (!hud.prompt || !hud.promptId) return false
	return hud.promptId !== hud.dismissedPromptId
}

function derivePhase(hud: HudState): RunHudPhase {
	if (hud.status && TERMINAL_STATUSES.has(hud.status)) return RunHudPhase.Done
	if (hasPrompt(hud)) return RunHudPhase.Prompting
	if (getActiveStreamingMessageFromHud(hud)) return RunHudPhase.Streaming
	return RunHudPhase.Passive
}

/**
 * Project the server-owned run state machine into the HUD. The server remains
 * authoritative for status, the current agent, and the replyable prompt.
 * The session applies recovered content before synchronizing this snapshot,
 * then reconciles history and selection once against the final HUD state.
 */
function pollApplied(
	hud: HudState,
	runView: Pick<
		RunView,
		"status" | "current_agent_name" | "current_prompt" | "current_prompt_id"
	>,
): HudState {
	let next: HudState = {
		...hud,
		status: runView.status,
		currentAgentName: runView.current_agent_name,
		isCancelling: runView.status === "cancelling",
	}

	if (
		runView.current_prompt &&
		runView.current_prompt_id &&
		runView.current_prompt_id !== hud.dismissedPromptId
	) {
		next = {
			...next,
			prompt: runView.current_prompt,
			promptId: runView.current_prompt_id,
			isInterrupting: false,
			isSettling: false,
		}
		return next
	}

	if (!runView.current_prompt) {
		next = {
			...next,
			prompt: null,
			promptId: null,
		}
		if (runView.status !== "awaiting_user_input") {
			next = { ...next, isSettling: false }
		}
	}

	return next
}

function buildHudMessages(
	logItems: StreamLogItem[],
	prompt: string | null,
	promptId: string | null,
): HudMessage[] {
	let messages = logItems.flatMap((item, logIndex): HudMessage[] => {
		if (
			item.kind !== StreamLogItemKind.Message ||
			item.hudContent === undefined
		) {
			return []
		}

		const id = `log:${logIndex}`
		return [{ id, ...item.hudContent, replyId: null }]
	})

	if (prompt === null || promptId === null) return messages

	const promptIndex = messages.findLastIndex(
		(message) => message.text === prompt && message.contentType === "markdown",
	)
	if (promptIndex < 0) {
		return [
			...messages,
			{ id: `prompt:${promptId}`, text: prompt, contentType: "markdown", replyId: promptId },
		]
	}
	messages = [...messages]
	messages[promptIndex] = { ...messages[promptIndex], replyId: promptId }
	return messages
}

function navigateMessage(
	messages: HudMessage[],
	selectedMessageId: string | null,
	direction: HudMessageNavigationDirection,
): string | null {
	if (direction === "first") return messages[0]?.id ?? null
	if (direction === "latest") {
		const latestMessage = messages.at(-1)
		return latestMessage?.replyId ? latestMessage.id : null
	}

	const selectedIndex = messages.findIndex(
		(message) => message.id === selectedMessageId,
	)
	if (direction === "previous") {
		if (selectedIndex > 0) return messages[selectedIndex - 1].id
		if (selectedIndex < 0) return messages.at(-1)?.id ?? null
		return selectedMessageId
	}
	if (selectedIndex < 0) return null
	return messages[selectedIndex + 1]?.id ?? null
}

function retainedSelection(
	previous: HudState,
	messages: HudMessage[],
	activePromptMessageId: string | null,
): string | null {
	if (messages.some((message) => message.id === previous.selectedMessageId)) {
		return previous.selectedMessageId
	}

	const previousSelection = previous.messages.find(
		(message) => message.id === previous.selectedMessageId,
	)
	return previousSelection?.replyId ? activePromptMessageId : null
}

function findActivePromptMessageId(
	messages: HudMessage[],
	promptId: string | null,
): string | null {
	if (promptId === null) return null
	return messages.find((message) => message.replyId === promptId)?.id ?? null
}

/** Apply immediate client-side state changes caused by HUD controls. */
function reduceControlHud(
	hud: HudState,
	event: ControlEvent,
): HudState {
	switch (event.type) {
		case "reply_submitted":
			return {
				...hud,
				dismissedPromptId: event.promptId,
				prompt: null,
				promptId: null,
				selectedMessageId: null,
				isMessageHistoryPinned: false,
			}
		case "hud_message_navigated": {
			const selectedMessageId = navigateMessage(
				hud.messages,
				hud.selectedMessageId,
				event.direction,
			)
			return { ...hud, selectedMessageId }
		}
		case "cancel_requested":
			return { ...hud, isCancelling: true }
		case "cancel_failed":
			return { ...hud, isCancelling: false }
		case "interrupt_requested":
			return { ...hud, isInterrupting: true }
		case "interrupt_failed":
			return { ...hud, isInterrupting: false }
	}
}

/** Reconcile history and selection once after an external input, including replay. */
export function reconcileHudState(
	previous: HudState,
	hud: HudState,
	logItems: StreamLogItem[],
	previousLogLength: number,
	event: SessionEvent,
): HudState {
	if (event.class === "control" && event.type === "hud_message_navigated") {
		hud = {
			...hud,
			isMessageHistoryPinned: hud.selectedMessageId !== null &&
				hud.selectedMessageId !== findActivePromptMessageId(hud.messages, hud.promptId),
		}
	}
	const promptChanged = previous.prompt !== hud.prompt || previous.promptId !== hud.promptId
	const historyAdded = logItems.slice(previousLogLength).some(
		(item) => item.kind === StreamLogItemKind.Message && item.hudContent !== undefined,
	)
	if (promptChanged || historyAdded) {
		const messages = buildHudMessages(logItems, hud.prompt, hud.promptId)
		const activePromptMessageId = findActivePromptMessageId(messages, hud.promptId)
		const selectedMessageId = retainedSelection(hud, messages, activePromptMessageId)
		const keepHistoryPinned =
			hud.isMessageHistoryPinned && selectedMessageId !== null &&
			selectedMessageId !== activePromptMessageId
		const previousSelection = previous.messages.find(
			(message) => message.id === previous.selectedMessageId,
		)
		const promptCleared =
			previous.promptId !== null && hud.promptId === null && Boolean(previousSelection?.replyId)
		let nextSelection = activePromptMessageId ?? messages.at(-1)?.id ?? null
		if (promptCleared || hud.streaming) nextSelection = null
		if (keepHistoryPinned) nextSelection = selectedMessageId
		hud = {
			...hud,
			messages,
			selectedMessageId: nextSelection,
			isMessageHistoryPinned: keepHistoryPinned,
		}
	}
	return { ...hud, phase: derivePhase(hud) }
}

/** Streaming and controls mutate HUD state; history is reconciled by the session. */
export function reduceHudState(
	hud: HudState,
	event: ContentEvent | ControlEvent | RunViewEvent,
): HudState {
	switch (event.class) {
		case "content":
			if (event.type === "delta") {
				const streaming = accumulateStreamingDelta(hud.streaming, event.delta)
				return {
					...hud,
					streaming,
					lastStreaming: streaming,
					isSettling: false,
					currentAgentName: streaming.agentName,
					selectedMessageId: hud.isMessageHistoryPinned ? hud.selectedMessageId : null,
				}
			}
			if (event.type === "reset") {
				return { ...hud, streaming: null, lastStreaming: null, isSettling: false }
			}
			return hud.streaming?.messageId === event.messageId
				? { ...hud, streaming: null, lastStreaming: hud.streaming, isSettling: true }
				: hud
		case "runView":
			return pollApplied(hud, event.runView)
		case "control":
			return reduceControlHud(hud, event)
	}
}
