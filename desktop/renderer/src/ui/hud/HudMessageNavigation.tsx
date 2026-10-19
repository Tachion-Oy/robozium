import { useLayoutEffect, useRef } from "react"

const directions = ["first", "previous", "next", "latest"] as const
const labels = ["Jump to first agent message", "Previous agent message", "Next agent message", "Jump to latest agent message"]

export function HudMessageNavigation({ selected, count, currentIndex = count - 1, onSelect, status = "Awaiting input" }: {
	status?: string
	currentIndex?: number
	selected: number; count: number; onSelect: (index: number) => void
}) {
	const buttons = useRef<(HTMLButtonElement | null)[]>([])
	const focusAfterNavigation = useRef<number | null>(null)
	useLayoutEffect(() => {
		if (focusAfterNavigation.current !== null) {
			buttons.current[focusAfterNavigation.current]?.focus()
			focusAfterNavigation.current = null
		}
	}, [selected])
	const navigate = (index: number) => {
		const next = [0, selected - 1, selected + 1, currentIndex][index]
		// A jump can enable the reverse arrow only after the selection commits.
		if (document.activeElement === buttons.current[index]) {
			if (next === 0) focusAfterNavigation.current = 2
				if (next === count - 1 || (index === 3 && next > 0)) focusAfterNavigation.current = 1
		}
		onSelect(next)
	}
	const arrow = (index: number) => (
		<button key={directions[index]} ref={element => { buttons.current[index] = element }}
			type="button" className="hud-history__button"
				disabled={count < 2 || (index < 2 ? selected === 0 : selected === (index === 3 ? currentIndex : count - 1))}
			aria-label={labels[index]} title={labels[index]} onClick={() => navigate(index)}>
			<svg className={`hud-history__arrow hud-history__arrow--${directions[index]}`}
				viewBox={index === 0 || index === 3 ? "0 0 22 14" : "0 0 16 14"} aria-hidden="true">
				{index === 0 ? <>
					<path d="M20.75 1.25 9.25 7 20.75 12.75Z" /><path d="M14.75 1.25 3.25 7 14.75 12.75Z" />
				</> : index === 3 ? <>
					<path d="M1.25 1.25 12.75 7 1.25 12.75Z" /><path d="M7.25 1.25 18.75 7 7.25 12.75Z" />
				</> : <path d="M8 1.25 14.75 12.75H1.25Z" />}
			</svg>
		</button>
	)
	return (
		<div className="hud-history" role="group" aria-label="Agent message history">
			<div className="hud-history__side">{arrow(0)}{arrow(1)}</div>
			<span className="hud-history__status" role="img" aria-label={status} title={status}>{status[0]}</span>
			<div className="hud-history__side">{arrow(2)}{arrow(3)}</div>
		</div>
	)
}
