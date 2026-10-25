import type { ReactNode } from "react"
import { markPath, markViewBox } from "./robozium-mark"

/** The Robozium mark in the current text colour, so the activity styles colour it. */
export function RoboziumMark(): ReactNode {
	return (
		<svg className="robozium-mark" viewBox={markViewBox} aria-hidden="true" focusable="false">
			<path d={markPath} />
		</svg>
	)
}
