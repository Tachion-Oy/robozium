import { useLayoutEffect, useRef } from "react"

const ACTION_SELECTOR = ".hud-footer__cancel, .hud-footer__interrupt, .hud-footer__helpers, .hud-footer__record, .hud-footer__send"

function laneWidth(actions: HTMLElement[], gap: number, scale: number) {
	return actions.reduce((width, action) => width + action.getBoundingClientRect().width / scale, 0) +
		Math.max(0, actions.length - 1) * gap
}

/** Keep desktop navigation centred and move crowded actions into normal flow. */
export function useDesktopActionLayout() {
	const ref = useRef<HTMLDivElement>(null)

	useLayoutEffect(() => {
		const root = ref.current
		if (!root) return
		const navigation = root.querySelector<HTMLElement>(".hud-history")
		if (!navigation) return
		let frame = 0

		const update = () => {
			const actions = Array.from(root.querySelectorAll<HTMLElement>(ACTION_SELECTOR))
			const style = getComputedStyle(root)
			const gap = parseFloat(style.columnGap) || 0
			const width = parseFloat(style.width)
			// Measure in layout pixels, including at fractional native zoom.
			const scale = root.getBoundingClientRect().width / width || 1
			const available = Math.max(0, (width - navigation.getBoundingClientRect().width / scale) / 2 - gap)
			const left = actions.filter(action => action.matches(".hud-footer__cancel, .hud-footer__interrupt"))
			const right = actions.filter(action => action.matches(".hud-footer__helpers, .hud-footer__record, .hud-footer__send"))

			// Cancel and Send are closest to their outside edges and remain longest.
			while (left.length && laneWidth(left, gap, scale) > available) left.pop()
			while (right.length && laneWidth(right, gap, scale) > available) right.shift()
			const primary = new Set([...left, ...right])
			const buttonHeight = Math.max(0, ...actions.filter(action => !action.matches(".hud-footer__helpers"))
				.map(action => action.getBoundingClientRect().height / scale))
			const height = Math.max(navigation.getBoundingClientRect().height / scale, buttonHeight)
			root.style.setProperty("--hud-copy-action-height", `${buttonHeight}px`)
			root.style.setProperty("--hud-primary-action-height", `${height}px`)
			for (const action of actions) {
				action.dataset.hudActionPlacement = primary.has(action) ? "primary" : "overflow"
			}
			for (const [lane, start] of [[left, 0], [right, width - laneWidth(right, gap, scale)]] as const) {
				let offset = start
				for (const action of lane) {
					action.style.setProperty("--hud-action-left", `${offset}px`)
					action.style.setProperty("--hud-action-top", `${(height - action.getBoundingClientRect().height / scale) / 2}px`)
					offset += action.getBoundingClientRect().width / scale + gap
				}
			}
		}
		const schedule = () => {
			cancelAnimationFrame(frame)
			frame = requestAnimationFrame(update)
		}
		const observer = new ResizeObserver(schedule)
		observer.observe(root)
		observer.observe(navigation)
		for (const action of Array.from(root.querySelectorAll<HTMLElement>(ACTION_SELECTOR))) observer.observe(action)
		update()
		return () => {
			cancelAnimationFrame(frame)
			observer.disconnect()
		}
	}, [])

	return ref
}
