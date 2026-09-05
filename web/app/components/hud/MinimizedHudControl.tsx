"use client"

import type { AgentActivityState } from "@/lib/robosprawl/session/reducer"

type MinimizedHudControlProps = {
	/** Visible only while the HUD is dismissed; hidden (faded out) when open. */
	visible: boolean
	/** Live agent activity, or null once agent work has ended. */
	agentActivityState: AgentActivityState | null
	onExpand: () => void
}

/**
 * The re-entry widget the HUD collapses into when dismissed: a small regular
 * octagon centred on the same point as the HUD box. The brand "A" on top is a
 * passive working/awaiting-input indicator; the Expand button below reopens the
 * HUD (the only way back). It sits vertically centred in the left gutter so the
 * transcript stays unobstructed. Mounted for the whole run route, including
 * recovery.
 */
export function MinimizedHudControl({
	visible,
	agentActivityState,
	onExpand,
}: MinimizedHudControlProps) {
	const overlayClassName = `agent-hud__mini${
		visible ? "" : " agent-hud__mini--hidden"
	}`

	return (
		<div
			className={overlayClassName}
			inert={!visible}>
			<div className="agent-hud__mini-box">
				<span
					className="agent-hud__logo agent-hud__logo--mini"
					data-agent-state={agentActivityState ?? undefined}
					aria-hidden="true">
					A
				</span>
				<button
					type="button"
					className="agent-hud__expand agent-hud__mini-expand"
					onClick={onExpand}>
					Expand
				</button>
			</div>
		</div>
	)
}
