// Build completed HUD history, group script chunks and preserve identities during recovery.
// Live append and recovered history use the same event projection; breaks belong only to display.
import { RunFrameKind, type RunRecord } from "../run/run-contracts"
import { extendScriptMessage, toHudMessage, toScriptMessage, type HudScriptMessage, type RecordedHudMessage } from "./hud-messages"

export interface HudHistory {
	messages: readonly RecordedHudMessage[]
	openScriptId: string | null
	breaks: readonly number[]
}

interface EventProjection {
	message: RecordedHudMessage | null
	openScript: HudScriptMessage | null
}

export function initialHistory(): HudHistory {
	return { messages: [], openScriptId: null, breaks: [] }
}

function projectEvent(event: RunRecord, script: HudScriptMessage | null): EventProjection {
	switch (event.type) {
		case RunFrameKind.ScriptOutput: {
			const message = script ? extendScriptMessage(script, event) : toScriptMessage(event)
			return { message, openScript: message }
		}
		case RunFrameKind.Message:
			return { message: toHudMessage(event), openScript: null }
		case RunFrameKind.LlmRetry:
		case RunFrameKind.RuntimeNotice:
			return { message: null, openScript: script }
		case RunFrameKind.Lifecycle:
			return { message: null, openScript: null }
	}
}

function appendEvent(history: HudHistory, event: RunRecord): HudHistory {
	const last = history.messages.at(-1)
	const script = last?.source === "script" && last.id === history.openScriptId ? last : null
	const projected = projectEvent(event, script)
	const openScriptId = projected.openScript?.id ?? null
	if (!projected.message) return { ...history, openScriptId }
	const messages = new Map(history.messages.map(message => [message.id, message]))
	messages.set(projected.message.id, projected.message)
	return { ...history, messages: [...messages.values()], openScriptId }
}

/** The record or break between two groups never goes away, so a rebuilt group holds at most one earlier group's anchor. */
function findScriptAnchor(previous: readonly RecordedHudMessage[], group: HudScriptMessage): HudScriptMessage | null {
	for (const message of previous) {
		if (message.source !== "script") continue
		if (message.anchorSequence >= group.firstSequence && message.anchorSequence <= group.lastSequence) return message
	}
	return null
}

function retainScriptIdentities(previous: readonly RecordedHudMessage[], rebuilt: readonly RecordedHudMessage[]): RecordedHudMessage[] {
	return rebuilt.map(message => {
		if (message.source !== "script") return message
		const anchor = findScriptAnchor(previous, message)
		return anchor ? { ...message, id: anchor.id, anchorSequence: anchor.anchorSequence } : message
	})
}

function recoverHistory(history: HudHistory, events: readonly RunRecord[]): HudHistory {
	const collected = new Map<string, RecordedHudMessage>()
	let script: HudScriptMessage | null = null
	let nextBreak = 0
	for (const event of events) {
		while (nextBreak < history.breaks.length && history.breaks[nextBreak] < event.sequence) {
			script = null
			nextBreak++
		}
		const projected = projectEvent(event, script)
		if (projected.message) collected.set(projected.message.id, projected.message)
		script = projected.openScript
	}
	const messages = retainScriptIdentities(history.messages, [...collected.values()])
	const scriptIsOpen = script !== null && script.lastSequence > (history.breaks.at(-1) ?? -1)
	return { ...history, messages, openScriptId: scriptIsOpen ? messages.at(-1)?.id ?? null : null }
}

/** Rebuild only for recovered records or a break that splits already received output. */
export function updateHudHistory(
	history: HudHistory,
	previousEvents: readonly RunRecord[],
	events: readonly RunRecord[],
	breakAfter: number | null,
): HudHistory {
	let next = history
	if (events !== previousEvents) {
		const last = events.at(-1)
		const appended = last && events.length === previousEvents.length + 1
			&& last.sequence > (previousEvents.at(-1)?.sequence ?? -1)
			&& last.sequence > (history.breaks.at(-1) ?? -1)
		next = appended ? appendEvent(history, last) : recoverHistory(history, events)
	}
	if (breakAfter === null || next.breaks.includes(breakAfter)) return next
	const breaks = [...next.breaks, breakAfter].sort((a, b) => a - b)
	next = { ...next, breaks, openScriptId: null }
	if (breakAfter < (events.at(-1)?.sequence ?? -1)) return recoverHistory(next, events)
	return next
}
