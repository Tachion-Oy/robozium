import type { ReactNode } from "react"
import type { AgentActivityState } from "../run/run-view"

/**
 * The Robozium mark in the current text colour, so the activity styles colour it.
 * The shape is public/branding/robozium-mark.svg, drawn as a mask; replacing that
 * file changes the mark here and in the app icon (scripts/build-icon.ts).
 */
export function RoboziumMark(): ReactNode {
	return <span className="robozium-mark" aria-hidden="true" />
}

/**
 * The activity indicator around the mark. While the agent works, a second copy of
 * the mark sits on a pulse layer that the styles fade in and out with opacity only.
 */
export function AgentIndicator({ className, agentActivityState }: {
	className: string
	agentActivityState: AgentActivityState | null
}): ReactNode {
	return (
		<span className={`agent-hud__logo ${className}`} data-agent-state={agentActivityState ?? undefined} aria-hidden="true">
			<RoboziumMark />
			<span className="agent-hud__logo-pulse"><RoboziumMark /></span>
		</span>
	)
}
