import type { ReactNode } from "react"
import type { AgentActivityState } from "@/lib/robozium/session/reducer"

/** Shared minimized shell and activity mark for re-entry and desktop loading. */
export function MinimizedHudFrame({ agentActivityState, heading, children }: {
	agentActivityState: AgentActivityState | null
	heading?: ReactNode
	children?: ReactNode
}) {
	return (
		<div className="agent-hud__mini-box">
			{heading}
			<span
				className="agent-hud__logo agent-hud__logo--mini"
				data-agent-state={agentActivityState ?? undefined}
				aria-hidden="true">
				A
			</span>
			{children}
		</div>
	)
}
