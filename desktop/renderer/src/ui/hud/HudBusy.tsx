// A wait the user cannot interrupt: the content goes faint and inert, and the mark
// pulses over it until the outcome arrives. The password dialog and Environment share it.
import type { ReactNode } from "react"
import { RoboziumMark } from "../branding/RoboziumMark"

export function HudBusy({ busy, label, className = "", children }: {
	busy: boolean
	/** What is being waited for, read by assistive technology. */
	label: string
	className?: string
	children: ReactNode
}) {
	return (
		<div className={`agent-hud__busy-host ${className}`.trim()} data-busy={busy || undefined}>
			<div className="agent-hud__busy-content contents" inert={busy}>{children}</div>
			{busy && <div className="agent-hud__busy" role="status" aria-label={label}><RoboziumMark /></div>}
		</div>
	)
}
