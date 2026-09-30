"use client"

import { useLayoutEffect, useRef, type ReactNode } from "react"

type TerminalLogProps = {
	children: ReactNode
	/** Compact mode: cram + clamp each message to ~3 lines (the live log). */
	clamp?: boolean
	/** Play a one-shot fade-in (the live log, once its data has hydrated). */
	enter?: boolean
	/** Let the user scroll back through history (landing or HUD minimized). */
	scrollable?: boolean
}

/**
 * Terminal-style log.
 *
 * The outer rail owns viewport height (`flex-1 min-h-0`). The masked log
 * box itself intentionally does NOT fill that height: it shrink-wraps to
 * content when short, which keeps single-line logs near the top.
 *
 * Once content exceeds the rail, `max-h-full` clamps the box and
 * `flex-col-reverse` keeps the live tail pinned: scroll offsets are
 * bottom-relative (`scrollTop === 0` is the tail, negative is scrolled up),
 * so the tail stays visible under `overflow-hidden` and stays pinned under
 * `overflow-y-auto` with no scroll scripting.
 *
 * The box (the scroll container) is capped at `max-w-360` — the inner
 * column's `max-w-336` plus `px-12` on both sides — so its scrollbar hugs
 * the message column instead of sitting at the viewport edge.
 */
export function TerminalLog({
	children,
	clamp = false,
	enter = false,
	scrollable = false,
}: TerminalLogProps) {
	const boxRef = useRef<HTMLDivElement>(null)
	const lastScrollHeight = useRef(0)

	useLayoutEffect(() => {
		const box = boxRef.current
		if (!box) return
		const content = box.firstElementChild ?? box
		const preserveScrollPosition = () => {
			const nextScrollHeight = box.scrollHeight
			const grown = nextScrollHeight - lastScrollHeight.current
			lastScrollHeight.current = nextScrollHeight
			if (!scrollable) {
				box.scrollTop = 0
				return
			}
			// Scrolled up: offsets are bottom-relative in column-reverse, so
			// growth at the tail would drag the view along; hold the reading
			// position by keeping the distance from the top constant.
			if (grown > 0 && box.scrollTop < 0) box.scrollTop -= grown
		}

		preserveScrollPosition()
		if (!("ResizeObserver" in window)) return
		const observer = new ResizeObserver(preserveScrollPosition)
		observer.observe(content)
		return () => observer.disconnect()
	}, [scrollable])

	const logClasses = [
		"term-log",
		clamp && "term-log--clamp",
		enter && "term-log--enter",
		scrollable && "term-log--scrollable",
		scrollable ? "overflow-y-auto" : "overflow-hidden",
		"mx-auto flex w-full max-w-360 max-h-full flex-col-reverse px-12",
	]
		.filter(Boolean)
		.join(" ")

	return (
		<div className="flex flex-1 min-h-0 w-full items-start pb-[3vh]">
			<div ref={boxRef} className={logClasses}>
				{/* Keep the final badge / tag halo inside the overflow clip. */}
				<div className="mx-auto flex w-full max-w-336 flex-col pb-6">
					{children}
				</div>
			</div>
		</div>
	)
}
