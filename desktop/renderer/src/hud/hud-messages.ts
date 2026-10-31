// Interpret validated message content for the plain-text HUD. No history or selection state.
// Backend payload validation lives in run/run-payloads; these types describe display content.
import { AgentAction, MessageKind, MessageRole, RunEventType, type RunRecord } from "../run/run-contracts"

type MessageEvent = Extract<RunRecord, { type: typeof RunEventType.Message }>
type ScriptEvent = Extract<RunRecord, { type: typeof RunEventType.ScriptOutput }>

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

export interface HudLiveText {
	id: string
	agent: string
	raw: string
	sequence: number
}

function promptText(content: string): string | null {
	let action: unknown
	try {
		action = JSON.parse(content)
	} catch {
		return null
	}
	if (!action || typeof action !== "object") return null
	if (!("action" in action) || action.action !== AgentAction.PromptUser) return null
	if (!("value" in action) || typeof action.value !== "string") return null
	return action.value
}

export function messageText(event: MessageEvent): string | null {
	if (event.role !== MessageRole.Assistant) return null
	if (event.kind === MessageKind.UserNotification) return event.content
	return promptText(event.content)
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
