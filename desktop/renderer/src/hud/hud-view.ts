// Compose completed output with the active prompt, preserve pinned history and select one display.
// This cached view changes with messages/prompts; token updates only replace live text.
import { isTerminal, RunStatus } from "../run/run-contracts"
import type { RunPrompt, RunState } from "../run/run-reducer"
import { streamingText, type HudLiveText, type HudMessage, type RecordedHudMessage } from "./hud-messages"

export const runLabels: Record<RunStatus, string> = {
	[RunStatus.Queued]: "Queued",
	[RunStatus.Running]: "Running",
	[RunStatus.AwaitingUserInput]: "Awaiting input",
	[RunStatus.Cancelling]: "Cancelling",
	[RunStatus.Completed]: "Completed",
	[RunStatus.Failed]: "Failed",
	[RunStatus.Cancelled]: "Cancelled",
}

export interface HudMessageList {
	messages: readonly HudMessage[]
	indices: ReadonlyMap<string, number>
	activePromptId: string | null
}

export interface HudPresentation {
	view: HudMessageList
	selectedMessageId: string | null
	liveText: HudLiveText | null
}

/** Agent messages and prompts are Markdown; script and live output stay literal. */
export type ContentType = "plain-text" | "markdown"

export interface HudDisplay {
	id: string
	text: string
	contentType: ContentType
	streaming: boolean
	index: number
	currentIndex: number
	count: number
}

export function initialMessageList(): HudMessageList {
	return { messages: [], indices: new Map(), activePromptId: null }
}

function retainPinnedPrompt(previous: HudMessageList, messages: HudMessage[], selectedId: string | null): void {
	if (selectedId === null || messages.some(message => message.id === selectedId)) return
	const index = previous.indices.get(selectedId)
	if (index === undefined) return
	const selected = previous.messages[index]
	if (selected?.source === "prompt") messages.splice(Math.min(index, messages.length), 0, selected)
}

export function buildMessageList(
	previous: HudMessageList,
	completed: readonly RecordedHudMessage[],
	prompt: RunPrompt | null,
	selectedId: string | null,
): HudMessageList {
	const messages: HudMessage[] = [...completed]
	let activePromptId: string | null = null
	if (prompt) {
		const match = [...completed].reverse().find(message => message.source === "message" && message.text === prompt.text)
		activePromptId = match?.id ?? `prompt:${prompt.id}`
		if (!match) messages.push({ id: activePromptId, text: prompt.text, source: "prompt" })
	}
	retainPinnedPrompt(previous, messages, selectedId)
	return { messages, indices: new Map(messages.map((message, index) => [message.id, index])), activePromptId }
}

/** Priority: explicitly pinned message, active prompt, live/settling text, latest completed output. */
export function selectHudDisplay(state: HudPresentation | null, run: RunState | null, openScriptId: string | null): HudDisplay {
	const empty: HudDisplay = { id: "empty", text: "", contentType: "plain-text", streaming: false, index: 0, currentIndex: 0, count: 0 }
	if (!state || !run) return empty
	const { view, selectedMessageId, liveText } = state
	const promptIndex = view.activePromptId === null ? undefined : view.indices.get(view.activePromptId)
	const live = promptIndex === undefined ? liveText : null
	const count = view.messages.length + (live ? 1 : 0)
	const currentIndex = promptIndex ?? Math.max(0, count - 1)
	const selectedIndex = selectedMessageId === null ? undefined : view.indices.get(selectedMessageId)
	const index = selectedIndex ?? currentIndex
	if (live && index === view.messages.length) {
		return {
			id: live.id, text: streamingText(live.raw), contentType: "plain-text",
			streaming: !live.settling && !isTerminal(run.status), index, currentIndex, count,
		}
	}
	const message = view.messages[index]
	if (!message) return empty
	return {
		id: message.id, text: message.text, index, currentIndex, count,
		contentType: message.source === "script" ? "plain-text" : "markdown",
		streaming: message.id === openScriptId && !run.prompt && !isTerminal(run.status),
	}
}
