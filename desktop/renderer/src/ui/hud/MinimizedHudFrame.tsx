// The Robozium mark replaces the "A".
import type { ReactNode } from "react"
import type { AgentActivityState } from "../run/run-view"
import { AgentIndicator } from "../branding/RoboziumMark"

/** Shared minimized shell and activity mark for re-entry and desktop loading. */
export function MinimizedHudFrame({ agentActivityState, heading, children }: {
	agentActivityState: AgentActivityState | null
	heading?: ReactNode
	children?: ReactNode
}) {
	return (
		<div className="agent-hud__mini-box">
			{heading}
			<AgentIndicator className="agent-hud__logo--mini" agentActivityState={agentActivityState} />
			{children}
		</div>
	)
}
