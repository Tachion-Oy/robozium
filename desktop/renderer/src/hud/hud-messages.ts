// Interpret validated message content for the plain-text HUD. No history or selection state.
// Backend payload validation lives in run/run-payloads; these types describe display content.
import { MessageRole, RunFrameKind, type RunRecord } from "../run/run-contracts"

type MessageEvent = Extract<RunRecord, { type: typeof RunFrameKind.Message }>
type ScriptEvent = Extract<RunRecord, { type: typeof RunFrameKind.ScriptOutput }>

/** The kinds the backend puts on messages written for the user. The HUD shows these as written; other assistant messages are tool calls. */
enum UserMessageKind {
	Notification = "user_notification",
	Prompt = "user_prompt",
}
const USER_MESSAGE_KINDS: ReadonlySet<string> = new Set(Object.values(UserMessageKind))

interface MessageContent { id: string; text: string }
export interface HudAgentMessage extends MessageContent { source: "message" }
export interface HudPromptMessage extends MessageContent { source: "prompt" }
export interface HudScriptMessage extends MessageContent {
	source: "script"
	firstSequence: number
	lastSequence: number
	/** The original output anchor keeps identity stable through prefix recovery and splitting. */
	anchorSequence: number
}
export type RecordedHudMessage = HudAgentMessage | HudScriptMessage
export type HudMessage = RecordedHudMessage | HudPromptMessage

export function messageText(event: MessageEvent): string | null {
	if (event.role !== MessageRole.Assistant) return null
	if (event.kind === null) return null
	if (!USER_MESSAGE_KINDS.has(event.kind)) return null
	return event.content
}

export function streamingText(raw: string): string {
	return raw
		.replace(/\\n/g, "\n")
		.replace(/\\t/g, "\t")
		.replace(/\\(["\\])/g, "$1")
		.replace(/[{}"]/g, "")
		.replace(/^[\s,]+/, "")
}

export function toHudMessage(event: MessageEvent): HudAgentMessage | null {
	const text = messageText(event)
	if (text === null) return null
	return { id: `message:${event.id ?? event.sequence}`, text, source: "message" }
}

export function toScriptMessage(event: ScriptEvent): HudScriptMessage {
	return {
		id: `script:${event.sequence}`,
		text: event.content,
		source: "script",
		firstSequence: event.sequence,
		lastSequence: event.sequence,
		anchorSequence: event.sequence,
	}
}

export function extendScriptMessage(previous: HudScriptMessage, event: ScriptEvent): HudScriptMessage {
	return { ...previous, text: previous.text + event.content, lastSequence: event.sequence }
}
