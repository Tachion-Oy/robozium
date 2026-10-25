// Copied from robozium-electron/desktop/web/app/components/hud/MinimizedHudFrame.tsx at 076b2c9.
// Adapted: the Robozium mark replaces the "A".
import type { ReactNode } from "react"
import type { AgentActivityState } from "../run/run-view"
import { RoboziumMark } from "../branding/RoboziumMark"

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
				<RoboziumMark />
			</span>
			{children}
		</div>
	)
}
