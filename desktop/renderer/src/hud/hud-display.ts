// Compose completed output with the active prompt, preserve pinned history and select the one display.
// The message list changes with messages/prompts; token updates only replace live text.
import { isTerminal } from "../run/run-contracts"
import type { HudState, RunPrompt, RunState } from "../session/session-reducer"
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
	// A wait without text, as after a failed model call, leaves the latest output in view.
	if (prompt && prompt.text !== "") {
		const match = [...completed].reverse().find(message => message.source === "message" && message.text === prompt.text)
		activePromptId = match?.id ?? `prompt:${prompt.id}`
		if (!match) messages.push({ id: activePromptId, text: prompt.text, source: "prompt" })
	}
	retainPinnedPrompt(previous, messages, selectedId)
	return { messages, indices: new Map(messages.map((message, index) => [message.id, index])), activePromptId }
}

/** Priority: explicitly pinned message, active prompt, live text or the working indicator, latest completed output. */
export function selectHudMessage(state: HudState | null, run: RunState | null): HudDisplay {
	const empty: HudDisplay = { id: "empty", text: "", contentType: "plain-text", streaming: false, working: false, index: 0, currentIndex: 0, count: 0 }
	if (!state || !run) return empty
	const { view, selectedMessageId, liveText } = state
	const promptIndex = view.activePromptId === null ? undefined : view.indices.get(view.activePromptId)
	const live = promptIndex === undefined ? liveText : null
	const liveDisplay = live ? streamingText(live.raw) : ""
	// Live text without visible characters yet, such as leading JSON punctuation, shows the agent working.
	const working = promptIndex === undefined && !isTerminal(run.status) && (live ? !liveDisplay.trim() : state.working)
	const count = view.messages.length + (live || working ? 1 : 0)
	const currentIndex = promptIndex ?? Math.max(0, count - 1)
	const selectedIndex = selectedMessageId === null ? undefined : view.indices.get(selectedMessageId)
	const index = selectedIndex ?? currentIndex
	if (index === view.messages.length && (live || working)) {
		// Settled text stays in the streaming style: it was never a completed HUD message.
		return {
			id: live?.id ?? "working", text: working ? [AGENT_WORKING_TEXT, ...state.thinkingLines].join("\n") : liveDisplay, contentType: "plain-text",
			streaming: !isTerminal(run.status), working, index, currentIndex, count,
		}
	}
	const message = view.messages[index]
	if (!message) return empty
	return {
		id: message.id, text: message.text, working: false, index, currentIndex, count,
		contentType: message.source === "script" ? "plain-text" : "markdown",
		streaming: message.id === state.history.openScriptId && !run.prompt && !isTerminal(run.status),
	}
}
