// Copied from robozium-electron/desktop/web/hooks/useDesktopActionLayout.ts at 076b2c9.
// Adapted: actions sit all beside the navigation or all on one row below it. The copy
// controls are not footer actions: they sit on the right edge (AgentHud).
import { useLayoutEffect, useRef } from "react"

const ACTION_SELECTOR = ".agent-hud__cancel, .agent-hud__interrupt, .agent-hud__image, .agent-hud__dictate, .agent-hud__send"

/** An action's untruncated width: labels clipped in the row below still count in full. */
function naturalWidth(action: HTMLElement, scale: number) {
	const clipped = Array.from(action.querySelectorAll<HTMLElement>(":scope > span"))
		.reduce((width, label) => width + Math.max(0, label.scrollWidth - label.clientWidth), 0)
	return action.getBoundingClientRect().width / scale + clipped
}

function laneWidth(actions: HTMLElement[], gap: number, scale: number) {
	return actions.reduce((width, action) => width + naturalWidth(action, scale), 0) +
		Math.max(0, actions.length - 1) * gap
}

/** Keep desktop navigation centred and move all actions below it when the side lanes are too narrow. */
export function useDesktopActionLayout() {
	const ref = useRef<HTMLDivElement>(null)

	useLayoutEffect(() => {
		const root = ref.current
		if (!root || !document.documentElement.hasAttribute("data-desktop")) return
		const navigation = root.querySelector<HTMLElement>(".agent-hud__message-nav")
		if (!navigation) return
		let frame = 0

		const update = () => {
			const actions = Array.from(root.querySelectorAll<HTMLElement>(ACTION_SELECTOR))
			const style = getComputedStyle(root)
			const gap = parseFloat(style.columnGap) || 0
			const width = parseFloat(style.width)
			// The reply form scales during its entrance. Position in layout pixels,
			// so a finished transform cannot leave stale offsets between controls.
			const scale = root.getBoundingClientRect().width / width || 1
			const available = Math.max(0, (width - navigation.getBoundingClientRect().width / scale) / 2 - gap)
			const left = actions.filter(action => action.matches(".agent-hud__cancel, .agent-hud__interrupt"))
			const right = actions.filter(action => action.matches(".agent-hud__image, .agent-hud__dictate, .agent-hud__send"))

			const beside = laneWidth(left, gap, scale) <= available && laneWidth(right, gap, scale) <= available
			root.dataset.hudActions = beside ? "beside" : "below"
			const primary = new Set(beside ? actions : [])
			const buttonHeight = Math.max(0, ...actions.map(action => action.getBoundingClientRect().height / scale))
			const height = Math.max(navigation.getBoundingClientRect().height / scale, buttonHeight)
			root.style.setProperty("--hud-primary-action-height", `${height}px`)
			for (const action of actions) {
				action.dataset.hudActionPlacement = primary.has(action) ? "primary" : "overflow"
			}
			if (!beside) return
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
		for (const action of root.querySelectorAll<HTMLElement>(ACTION_SELECTOR)) observer.observe(action)
		const children = new MutationObserver(() => {
			for (const action of root.querySelectorAll<HTMLElement>(ACTION_SELECTOR)) observer.observe(action)
			schedule()
		})
		children.observe(root, { childList: true, subtree: true })
		update()
		return () => {
			cancelAnimationFrame(frame)
			observer.disconnect()
			children.disconnect()
		}
	}, [])

	return ref
}
