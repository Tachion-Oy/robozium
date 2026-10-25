import type { ReactNode } from "react"

/**
 * The Robozium mark in the current text colour, so the activity styles colour it.
 * The shape is public/branding/robozium-mark.svg, drawn as a mask; replacing that
 * file changes the mark here and in the app icon (scripts/build-icon.ts).
 */
export function RoboziumMark(): ReactNode {
	return <span className="robozium-mark" aria-hidden="true" />
}
