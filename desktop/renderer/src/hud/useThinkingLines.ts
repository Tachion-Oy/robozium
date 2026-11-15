// While a model call runs without visible output, add a timestamped line every 10 seconds,
// so a long call reads as thinking rather than a hang. Models that stream their reasoning
// also report a growing token estimate; models that hide it show the line alone.
import { useEffect, useRef, useState } from "react"
import { RunFrameKind, type RunRecord } from "../run/run-contracts"
import type { HudDisplay } from "./hud-view"

export const THINKING_LINE_INTERVAL_MS = 10_000
/** Providers report exact reasoning tokens only when the call ends; four characters approximate one. */
const CHARACTERS_PER_TOKEN = 4

export interface OpenModelCall {
	id: string
	model: string
	reasoningChars: number | null
}

/** The latest model call that has not succeeded and has not been followed by other run output. */
export function selectOpenModelCall(events: readonly RunRecord[]): OpenModelCall | null {
	let call: OpenModelCall | null = null
	for (const event of events) {
		switch (event.type) {
			case RunFrameKind.LlmCallStarted:
				call = { id: event.callId, model: event.model, reasoningChars: null }
				break
			case RunFrameKind.LlmCallProgress:
				if (call !== null && call.id === event.callId) {
					call = { id: call.id, model: call.model, reasoningChars: event.reasoningChars }
				}
				break
			case RunFrameKind.LlmRetry:
				break
			default:
				// Success, a message, script output, a notice or a lifecycle change ends the wait.
				call = null
		}
	}
	return call
}

function twoDigits(value: number): string {
	return String(value).padStart(2, "0")
}

export function thinkingLine(call: OpenModelCall, now: Date): string {
	const time = `${twoDigits(now.getHours())}:${twoDigits(now.getMinutes())}:${twoDigits(now.getSeconds())}`
	// Provider model names carry their vendor, such as "deepseek/deepseek-v4.1-flash".
	const model = call.model.slice(call.model.lastIndexOf("/") + 1)
	const line = `${time}: ${model} thinking`
	if (call.reasoningChars === null || call.reasoningChars === 0) {
		return line
	}
	const tokens = Math.round(call.reasoningChars / CHARACTERS_PER_TOKEN)
	return `${line}, ~${tokens.toLocaleString("en-US")} tokens`
}

interface CallLines {
	callId: string
	lines: string[]
}

export function useThinkingLines(call: OpenModelCall | null): readonly string[] {
	const [state, setState] = useState<CallLines | null>(null)
	const latestCall = useRef(call)
	useEffect(() => {
		latestCall.current = call
	})
	const callId = call === null ? null : call.id
	useEffect(() => {
		if (callId === null) return
		const timer = setInterval(() => {
			const current = latestCall.current
			if (current === null || current.id !== callId) return
			const line = thinkingLine(current, new Date())
			setState(previous => {
				if (previous === null || previous.callId !== callId) {
					return { callId, lines: [line] }
				}
				return { callId, lines: [...previous.lines, line] }
			})
		}, THINKING_LINE_INTERVAL_MS)
		return () => clearInterval(timer)
	}, [callId])
	if (state === null || state.callId !== callId) {
		return []
	}
	return state.lines
}

/** The lines follow the working indicator; any other display stays as it is. */
export function withThinkingLines(display: HudDisplay, lines: readonly string[]): HudDisplay {
	if (!display.working || lines.length === 0) {
		return display
	}
	return { ...display, text: [display.text, ...lines].join("\n") }
}
