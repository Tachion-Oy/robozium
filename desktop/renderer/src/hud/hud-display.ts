// Compose completed output with the active prompt and select the one display. Nothing here changes state.
// The message list changes with messages/prompts; token updates only replace live text.
import { isTerminal } from "../run/run-contracts"
import type { RunPrompt, RunSession } from "../session/session-reducer"
import { streamingText, type HudMessage, type RecordedHudMessage } from "./hud-messages"

export interface HudMessageList {
	messages: readonly HudMessage[]
	indices: ReadonlyMap<string, number>
	activePromptId: string | null
}

/** Shown in the streaming style while the agent works without visible output. */
const AGENT_WORKING_TEXT = "Agent is working..."
export const THINKING_LINE_INTERVAL_MS = 5_000
/** Providers report exact reasoning tokens only when a call ends; four characters approximate one. */
const CHARACTERS_PER_TOKEN = 4

/** The time and the model, with a token estimate once the model has streamed reasoning. */
export function thinkingLine(now: Date, model: string, reasoningChars: number | null): string {
	const line = `${now.toLocaleTimeString("en-GB")}: ${model} thinking`
	if (!reasoningChars) return line
	return `${line}, ~${Math.round(reasoningChars / CHARACTERS_PER_TOKEN).toLocaleString("en-US")} tokens`
}

/** Agent messages and prompts are Markdown; script and live output stay literal. */
export type ContentType = "plain-text" | "markdown"

export interface HudDisplay {
	id: string
	text: string
	contentType: ContentType
	streaming: boolean
	/** The working indicator stands in for output; it is not agent text. */
	working: boolean
	index: number
	currentIndex: number
	count: number
}

export function initialMessageList(): HudMessageList {
	return { messages: [], indices: new Map(), activePromptId: null }
}

export function buildMessageList(completed: readonly RecordedHudMessage[], prompt: RunPrompt | null): HudMessageList {
	const messages: HudMessage[] = [...completed]
	let activePromptId: string | null = null
	// A wait without text, as after a failed model call, leaves the latest output in view.
	if (prompt && prompt.text !== "") {
		const match = [...completed].reverse().find(message => message.source === "message" && message.text === prompt.text)
		activePromptId = match?.id ?? `prompt:${prompt.id}`
		if (!match) messages.push({ id: activePromptId, text: prompt.text, source: "prompt" })
	}
	return { messages, indices: new Map(messages.map((message, index) => [message.id, index])), activePromptId }
}

/** Priority: explicitly pinned message, active prompt, live text or the working indicator, latest completed output. */
export function selectRunDisplay(session: RunSession | null): HudDisplay {
	const empty: HudDisplay = { id: "empty", text: "", contentType: "plain-text", streaming: false, working: false, index: 0, currentIndex: 0, count: 0 }
	if (!session) return empty
	const { run, hud } = session
	const { view, selectedMessageId, liveText } = hud
	const promptIndex = view.activePromptId === null ? undefined : view.indices.get(view.activePromptId)
	const live = promptIndex === undefined ? liveText : null
	const liveDisplay = live === null ? "" : streamingText(live)
	// Live text without visible characters yet, such as leading JSON punctuation, shows the agent working.
	const working = promptIndex === undefined && !isTerminal(run.status) && (live === null ? hud.awaitingOutput : !liveDisplay.trim())
	// Live text or the working indicator follows the messages as one more item.
	const extra = live !== null || working
	const count = view.messages.length + (extra ? 1 : 0)
	const currentIndex = promptIndex ?? Math.max(0, count - 1)
	const selectedIndex = selectedMessageId === null ? undefined : view.indices.get(selectedMessageId)
	const index = selectedIndex ?? currentIndex
	if (index === view.messages.length && extra) {
		let id = "working"
		if (live !== null && run.streamMessage) id = `message:${run.streamMessage.id}`
		let text = liveDisplay
		if (working) text = [AGENT_WORKING_TEXT, ...hud.thinkingLines].join("\n")
		// Settled text stays in the streaming style: it was never a completed HUD message.
		return { id, text, contentType: "plain-text", streaming: !isTerminal(run.status), working, index, currentIndex, count }
	}
	const message = view.messages[index]
	if (!message) return empty
	return {
		id: message.id, text: message.text, working: false, index, currentIndex, count,
		contentType: message.source === "script" ? "plain-text" : "markdown",
		streaming: message.id === hud.history.openScriptId && !run.prompt && !isTerminal(run.status),
	}
}
