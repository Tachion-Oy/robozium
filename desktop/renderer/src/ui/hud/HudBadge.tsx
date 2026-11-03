// The badge the HUD shows a run's name in, top left; Environment names its sections with it.
import type { ReactNode } from "react"

export function HudBadge({ title, children }: { title?: string; children: ReactNode }) {
	return (
		<span className="agent-hud__event-label">
			<span className="term-msg-badge">
				<span className="term-msg-badge-label">
					<span title={title} className="agent-hud__event-text">{children}</span>
				</span>
			</span>
		</span>
	)
}
