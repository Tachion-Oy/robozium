// Copied from robozium-electron/desktop/web/app/components/hud/MinimizedHudFrame.tsx at 076b2c9.
import type { ReactNode } from "react"
import type { AgentActivityState } from "../run/run-view"

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
