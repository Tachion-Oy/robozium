// A wait the user cannot interrupt: the content goes faint and inert, and the pulsing
// mark from the startup loader shows over it, without its frame, until the outcome arrives. The password
// dialog and Environment share it.
import type { ReactNode } from "react"
import { createPortal } from "react-dom"
import { AgentIndicator } from "../branding/RoboziumMark"
import { AgentActivityState } from "../run/run-view"

export function HudBusy({ busy, label, window = false, className = "", children }: {
	busy: boolean
	/** What is being waited for, read by assistive technology. */
	label: string
	/** Lay the wait over the whole window, not only this content. */
	window?: boolean
	className?: string
	children: ReactNode
}) {
	const indicator = (
		<div className={`agent-hud__busy${window ? " agent-hud__busy--window" : ""}`} role="status" aria-label={label}>
			<AgentIndicator className="agent-hud__logo--mini" agentActivityState={AgentActivityState.Working} />
		</div>
	)
	return (
		<div className={`agent-hud__busy-host ${className}`.trim()} data-busy={busy || undefined} data-window={window || undefined}>
			<div className="agent-hud__busy-content contents" inert={busy}>{children}</div>
			{/* On the body, so no transformed ancestor confines the window layer. */}
			{busy && (window ? createPortal(indicator, document.body) : indicator)}
		</div>
	)
}
