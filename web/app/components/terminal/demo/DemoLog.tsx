"use client"

import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import {
	StreamLogItemKind,
	type MessageLogItem,
	type StreamLogItem,
} from "@/lib/robozium/view-model"
import { TerminalLog } from "../TerminalLog"
import { getRevealText } from "../TerminalStream"
import { placeholderLogItems } from "../placeholders"
import { C64Loader } from "../C64Loader"
import {
	lifecycleRevealText,
	renderContent,
	renderRevealItem,
} from "../renderContent"

// Landing-intro choreography. Rows enter in a tight cascade so the browser
// paints a small moving front instead of revealing every line simultaneously.
const INTRO_CHARS_PER_SECOND = 160
const INTRO_ROW_DELAY_MS = 85
const INTRO_ALTERNATE_DIRECTION = true
const INTRO_HUD_PAUSE_MS = 1600

function getIntroRowFrame(
	rowIndex: number,
	textLength: number,
	elapsedMs: number,
): { started: boolean; revealedChars: number } {
	const delayMs = rowIndex * INTRO_ROW_DELAY_MS
	if (elapsedMs < delayMs) return { started: false, revealedChars: 0 }
	return {
		started: true,
		revealedChars: Math.min(
			textLength,
			Math.floor(
				((elapsedMs - delayMs) * INTRO_CHARS_PER_SECOND) / 1000,
			),
		),
	}
}

function introRevealText(item: StreamLogItem): string {
	return item.kind === StreamLogItemKind.Lifecycle
		? lifecycleRevealText(item)
		: getRevealText(item as MessageLogItem)
}

/**
 * The static demo log, with the trailing shell prompt. `fadeIn` is false right
 * as the boot intro hands off to this (same content already visible, so no
 * fade is wanted there) and true when returning to landing after a run.
 */
export function PlaceholderLog({ fadeIn = false }: { fadeIn?: boolean }) {
	return (
		<TerminalLog enter={fadeIn}>
			{placeholderLogItems.map((item, i) => (
				<Fragment key={i}>{renderContent(item, "demo")}</Fragment>
			))}
			<C64Loader />
		</TerminalLog>
	)
}

/**
 * Fresh-load intro: rows launch in a staggered cascade, with each caret
 * advancing at INTRO_CHARS_PER_SECOND. The full text of every item is laid out
 * up front (untyped tail invisible, zero-width caret), so the stagger changes
 * paint timing without introducing reflow.
 */
export function IntroStream({ onIntroDone }: { onIntroDone: () => void }) {
	const revealTexts = useMemo(
		() => placeholderLogItems.map(introRevealText),
		[],
	)
	// Settled render of every item, memoised so finished lines don't re-parse
	// (JSON.parse + regex) on every animation frame. For messages we cross-fade
	// the formatted (tag / emphasis) layer in over a plain-looking, pixel-aligned
	// copy underneath, so the decoration materialises instead of popping and the
	// glyphs never move.
	const settled = useMemo(
		() =>
			placeholderLogItems.map((item, i) => (
				<Fragment key={i}>
					{renderRevealItem(
						item,
						revealTexts[i],
						revealTexts[i].length,
						"demo",
					)}
				</Fragment>
			)),
		[revealTexts],
	)

	const [elapsedMs, setElapsedMs] = useState(0)
	const doneRef = useRef(false)
	const pauseTimer = useRef<number | null>(null)
	const onIntroDoneRef = useRef(onIntroDone)

	useEffect(() => {
		onIntroDoneRef.current = onIntroDone
	}, [onIntroDone])

	useEffect(() => {
		const t0 = performance.now()
		let frameId = 0
		const step = (now: number) => {
			const nextElapsedMs = Math.max(0, now - t0)
			setElapsedMs(nextElapsedMs)
			const allRowsSettled = revealTexts.every(
				(text, rowIndex) =>
					getIntroRowFrame(
						rowIndex,
						text.length,
						nextElapsedMs,
					).revealedChars >= text.length,
			)
			if (!allRowsSettled) {
				frameId = requestAnimationFrame(step)
			} else if (!doneRef.current) {
				doneRef.current = true
				pauseTimer.current = window.setTimeout(
					() => onIntroDoneRef.current(),
					INTRO_HUD_PAUSE_MS,
				)
			}
		}
		frameId = requestAnimationFrame(step)
		return () => {
			cancelAnimationFrame(frameId)
			if (pauseTimer.current !== null) {
				window.clearTimeout(pauseTimer.current)
			}
		}
	}, [revealTexts])

	return (
		<TerminalLog>
			{placeholderLogItems.map((item, i) => {
				const text = revealTexts[i]
				const frame = getIntroRowFrame(
					i,
					text.length,
					elapsedMs,
				)
				const revealed = frame.revealedChars
				if (revealed >= text.length) return settled[i]
				const reversed = INTRO_ALTERNATE_DIRECTION && i % 2 === 1
				return (
					<Fragment key={i}>
						{renderRevealItem(item, text, revealed, "demo", {
							reversed,
							caretVisible: frame.started,
						})}
					</Fragment>
				)
			})}
			<C64Loader />
		</TerminalLog>
	)
}
