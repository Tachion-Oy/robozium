// While the run's own agent waits on a model call and the HUD shows the working indicator,
// add a timestamped line every 10 seconds, so a long call reads as thinking rather than a hang.
// Models that stream their reasoning also report a growing token estimate; models that hide it
// show the line alone.
import { useEffect, useRef, useState } from "react"
import { LifecyclePhase, RunFrameKind, type RunRecord } from "../run/run-contracts"
import type { HudDisplay } from "./hud-view"

export const THINKING_LINE_INTERVAL_MS = 10_000
/** Providers report exact reasoning tokens only when the call ends; four characters approximate one. */
const CHARACTERS_PER_TOKEN = 4

export interface OpenModelCall {
	id: string
	model: string
	reasoningChars: number | null
}

/**
 * The root agent's latest model call that has not succeeded. Background agents share the run's
 * events and call models too; their calls do not hold the user up and are left out.
 * A call that failed or was interrupted stays open until the agent's next call replaces it.
 */
export function selectOpenModelCall(events: readonly RunRecord[]): OpenModelCall | null {
	let rootAgent: string | null = null
	let call: OpenModelCall | null = null
	for (const event of events) {
		switch (event.type) {
			case RunFrameKind.Lifecycle: {
				const parent = event.details.parent_agent_name
				const hasParent = parent !== null && parent !== undefined
				if (rootAgent === null && event.phase === LifecyclePhase.Started && !hasParent) {
					rootAgent = event.agent
				}
				break
			}
			case RunFrameKind.LlmCallStarted:
				if (event.agent === rootAgent) {
					call = { id: event.callId, model: event.model, reasoningChars: null }
				}
				break
			case RunFrameKind.LlmCallProgress:
				if (call !== null && call.id === event.callId) {
					call = { id: call.id, model: call.model, reasoningChars: event.reasoningChars }
				}
				break
			case RunFrameKind.LlmCallSucceeded:
				if (call !== null && call.id === event.callId) {
					call = null
				}
				break
			default:
				break
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

/**
 * Lines for the open call, one every 10 seconds while `working`. They are dropped when the call
 * changes or the working indicator leaves, so a stale call never shows old lines.
 */
export function useThinkingLines(call: OpenModelCall | null, working: boolean): readonly string[] {
	const [lines, setLines] = useState<readonly string[]>([])
	// The timer reads the latest reasoning count without restarting on every progress event.
	const latestCall = useRef(call)
	useEffect(() => {
		latestCall.current = call
	})
	const callId = call === null ? null : call.id
	useEffect(() => {
		if (callId === null || !working) return
		const timer = setInterval(() => {
			const current = latestCall.current
			if (current === null) return
			const line = thinkingLine(current, new Date())
			setLines(previous => [...previous, line])
		}, THINKING_LINE_INTERVAL_MS)
		return () => {
			clearInterval(timer)
			setLines([])
		}
	}, [callId, working])
	return lines
}

/** The lines follow the working indicator; any other display stays as it is. */
export function withThinkingLines(display: HudDisplay, lines: readonly string[]): HudDisplay {
	if (!display.working || lines.length === 0) {
		return display
	}
	return { ...display, text: [display.text, ...lines].join("\n") }
}
