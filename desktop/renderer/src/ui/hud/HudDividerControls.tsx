import { useRef } from "react"
import { HudButton } from "../HudButton"
import "./hud-divider-controls.css"

const modes = ["top", "equal", "bottom"] as const
export type LayoutMode = typeof modes[number]

export function HudDividerControls({ mode, disabled, onChange }: {
	mode: LayoutMode
	disabled: boolean
	onChange: (mode: LayoutMode) => void
}) {
	const up = useRef<HTMLButtonElement>(null)
	const down = useRef<HTMLButtonElement>(null)
	const move = (direction: "up" | "down") => {
		const next = modes[Math.max(0, Math.min(2, modes.indexOf(mode) + (direction === "up" ? 1 : -1)))]
		// Transfer focus before the activated button becomes natively disabled.
		if (next === "bottom") down.current?.focus()
		if (next === "top") up.current?.focus()
		onChange(next)
	}
	return (
		<div className="hud-divider" role="group" aria-label={`Panel divider: ${mode}`}>
			{(["up", "down"] as const).map(direction => (
				<HudButton key={direction} ref={direction === "up" ? up : down}
					className="hud-divider__button" disabled={disabled || mode === (direction === "up" ? "bottom" : "top")}
					aria-label={`Move panel divider ${direction}`} title={`Move panel divider ${direction}`}
					onClick={() => move(direction)}>
					<svg className={`hud-divider__arrow hud-divider__arrow--${direction}`} viewBox="0 0 16 14" aria-hidden="true">
						<path d="M8 1.25 14.75 12.75H1.25Z" />
					</svg>
				</HudButton>
			))}
		</div>
	)
}
