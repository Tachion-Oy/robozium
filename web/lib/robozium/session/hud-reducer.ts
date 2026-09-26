import { accumulateStreamingDelta, type StreamingMessage } from "../stream"
import {
	PipeEventType,
	RunLifecycleKind,
	type RunStatus,
	type RunView,
} from "../wire"
import { StreamLogItemKind, type StreamLogItem } from "../view-model"
import { RunHudPhase } from "./reducer.types"
import type {
	ControlEvent,
	HudMessage,
	HudMessageNavigationDirection,
	HudState,
	RunViewEvent,
	PresentationEvent,
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
			item.hudText === undefined
		) {
			return []
		}

		const id = `log:${logIndex}`
		return [{ id, text: item.hudText, contentType: item.contentType, replyId: null }]
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

/**
 * Project the server-owned run state machine into the HUD. The server remains
 * authoritative for run status, the current agent, and the currently replyable
 * prompt; this helper only synchronizes that snapshot into client state.
 * Initial views also hydrate message history, while later polls preserve the
 * existing timeline unless the active prompt actually changes.
 */
function reduceRunViewHud(
	hud: HudState,
	event: RunViewEvent,
	logItems: StreamLogItem[],
): HudState {
	const isInitial = event.source === "initial"
	const nextHud = pollApplied(hud, event.runView)
	const promptChanged =
		hud.prompt !== nextHud.prompt || hud.promptId !== nextHud.promptId
	if (!isInitial && !promptChanged) return nextHud

	const messages = buildHudMessages(
		logItems,
		nextHud.prompt,
		nextHud.promptId,
	)
	const activePromptMessageId = findActivePromptMessageId(
		messages,
		nextHud.promptId,
	)
	const selectedMessageId = retainedSelection(
		hud,
		messages,
		activePromptMessageId,
	)
	const previousSelection = hud.messages.find(
		(message) => message.id === hud.selectedMessageId,
	)
	const activePromptCleared =
		hud.promptId !== null &&
		nextHud.promptId === null &&
		Boolean(previousSelection?.replyId)
	const keepHistoryPinned =
		hud.isMessageHistoryPinned &&
		selectedMessageId !== null &&
		selectedMessageId !== activePromptMessageId

	let nextSelectedMessageId = activePromptMessageId ?? selectedMessageId
	let isMessageHistoryPinned = false
	if (isInitial) {
		nextSelectedMessageId = nextHud.streaming ? null : messages.at(-1)?.id ?? null
	} else if (activePromptCleared) {
		nextSelectedMessageId = null
	} else if (keepHistoryPinned) {
		nextSelectedMessageId = selectedMessageId
		isMessageHistoryPinned = true
	}

	return {
		...nextHud,
		messages,
		selectedMessageId: nextSelectedMessageId,
		isMessageHistoryPinned,
	}
}

/** Apply immediate client-side state changes caused by HUD controls. */
function reduceControlHud(
	hud: HudState,
	event: ControlEvent,
	logItems: StreamLogItem[],
): HudState {
	switch (event.type) {
		case "reply_submitted":
			return {
				...hud,
				dismissedPromptId: event.promptId,
				prompt: null,
				promptId: null,
				messages: buildHudMessages(logItems, null, null),
				selectedMessageId: null,
				isMessageHistoryPinned: false,
			}
		case "hud_message_navigated": {
			const selectedMessageId = navigateMessage(
				hud.messages,
				hud.selectedMessageId,
				event.direction,
			)
			const activePromptMessageId = findActivePromptMessageId(
				hud.messages,
				hud.promptId,
			)
			return {
				...hud,
				selectedMessageId,
				isMessageHistoryPinned:
					selectedMessageId !== null &&
					selectedMessageId !== activePromptMessageId,
			}
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

/** Refresh history once, regardless of which input completed a message. */
function syncHistory(
	hud: HudState,
	logItems: StreamLogItem[],
	previousLogLength: number,
): HudState {
	const hasDisplayableItem = logItems.slice(previousLogLength).some(
		(item) => item.kind === StreamLogItemKind.Message && item.hudText !== undefined,
	)
	if (!hasDisplayableItem) return hud

	const messages = buildHudMessages(
		logItems,
		hud.prompt,
		hud.promptId,
	)
	const activePromptMessageId = findActivePromptMessageId(
		messages,
		hud.promptId,
	)
	const selectedMessageId = retainedSelection(
		hud,
		messages,
		activePromptMessageId,
	)
	const keepHistoryPinned =
		hud.isMessageHistoryPinned &&
		selectedMessageId !== null &&
		selectedMessageId !== activePromptMessageId

	return {
		...hud,
		messages,
		selectedMessageId: keepHistoryPinned
			? selectedMessageId
			: (messages.at(-1)?.id ?? null),
		isMessageHistoryPinned: keepHistoryPinned,
	}
}

/**
 * Route each session event to the helper that owns that input source, then
 * derive the display phase once from the completed HUD state.
 */
export function reduceHudState(
	hud: HudState,
	event: PresentationEvent,
	logItems: StreamLogItem[],
	previousLogLength: number,
): HudState {
	let nextHud: HudState

	switch (event.class) {
		case "content": {
			if (event.type === "delta") {
				const streaming = accumulateStreamingDelta(hud.streaming, event.delta)
				nextHud = {
					...hud,
					streaming,
					lastStreaming: streaming,
					isSettling: false,
					currentAgentName: streaming.agentName,
					selectedMessageId: hud.isMessageHistoryPinned ? hud.selectedMessageId : null,
				}
			} else if (event.type === "reset") {
				nextHud = { ...hud, streaming: null, lastStreaming: null, isSettling: false }
			} else {
				nextHud = hud.streaming?.messageId === event.messageId
					? { ...hud, streaming: null, lastStreaming: hud.streaming, isSettling: true }
					: hud
			}
			break
		}
		case "runView":
			nextHud = reduceRunViewHud(hud, event, logItems)
			break
		case "control":
			nextHud = reduceControlHud(hud, event, logItems)
			break
		case "stream":
			nextHud = hud
			if (
				event.type === "frame_received" &&
				event.frame.type === PipeEventType.RunLifecycle &&
				event.frame.payload.kind === RunLifecycleKind.Stopped &&
				event.frame.payload.parent_agent_name == null &&
				event.frame.payload.status
			) {
				nextHud = { ...hud, status: event.frame.payload.status }
			}
			break
	}

	nextHud = syncHistory(nextHud, logItems, previousLogLength)
	return { ...nextHud, phase: derivePhase(nextHud) }
}
