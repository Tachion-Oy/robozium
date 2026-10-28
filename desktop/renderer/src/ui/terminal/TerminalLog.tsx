// Copied from web/app/components/terminal/TerminalLog.tsx at db6a20f.
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

/** How long a newly appended row takes to slide the tail up into place. */
const SLIDE_MS = 220

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
 * Growth at the pinned tail slides in instead of jumping a whole row: the
 * column starts where it was and eases up into place on the compositor.
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
	const lastHeight = useRef(0)

	useLayoutEffect(() => {
		const box = boxRef.current
		if (!box) return
		const content = (box.firstElementChild ?? box) as HTMLElement
		const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)")
		// The row being read while scrolled up, and where it sat on screen.
		let anchor: { row: Element; top: number } | null = null
		let slide: Animation | null = null

		const rememberAnchor = () => {
			anchor = null
			if (!scrollable || box.scrollTop >= 0) return
			// Reading position is fixed; a running slide would move it.
			slide?.finish()
			const top = box.getBoundingClientRect().top
			for (const row of content.children) {
				const rect = row.getBoundingClientRect()
				if (rect.bottom > top) {
					anchor = { row, top: rect.top }
					return
				}
			}
		}

		const preserveScrollPosition = () => {
			// Layout height: a running slide's transform must not count as growth.
			const height = content.offsetHeight
			const grown = height - lastHeight.current
			const mounted = lastHeight.current > 0
			lastHeight.current = height
			if (!scrollable) box.scrollTop = 0
			// Scrolled up: rows above and below the view change height (appends,
			// offscreen rows laying out for the first time); keep the row being
			// read where it is.
			if (anchor?.row.isConnected) {
				box.scrollTop += anchor.row.getBoundingClientRect().top - anchor.top
				rememberAnchor()
				return
			}
			if (grown <= 0 || !mounted || reducedMotion.matches) return
			// Continue from wherever a running slide has got to.
			const offset = slide?.playState === "running"
				? new DOMMatrixReadOnly(getComputedStyle(content).transform).m42
				: 0
			slide?.cancel()
			slide = content.animate(
				[{ transform: `translateY(${offset + grown}px)` }, { transform: "none" }],
				{ duration: SLIDE_MS, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
			)
		}

		preserveScrollPosition()
		box.addEventListener("scroll", rememberAnchor, { passive: true })
		const observer = "ResizeObserver" in window ? new ResizeObserver(preserveScrollPosition) : null
		observer?.observe(content)
		return () => {
			observer?.disconnect()
			box.removeEventListener("scroll", rememberAnchor)
			slide?.cancel()
		}
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
