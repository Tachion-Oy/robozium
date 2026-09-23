import type {
	AgentActivityState,
	HudMessageNavigationDirection,
} from "@/lib/robozium/session/reducer"
import { MessageWedge } from "./MessageWedge"

export type HudMessageNavigationModel = {
	agentActivityState: AgentActivityState
	enabled: Record<HudMessageNavigationDirection, boolean>
	onNavigate: (direction: HudMessageNavigationDirection) => void
}

export function HudMessageNavigation({
	agentActivityState,
	enabled,
	onNavigate,
}: HudMessageNavigationModel) {
	return (
		<div
			className="agent-hud__message-nav"
			role="group"
			aria-label="Agent message history">
			<div className="agent-hud__message-nav-side">
				<button
					type="button"
					className="agent-hud__layout-direction agent-hud__message-direction"
					onClick={() => onNavigate("first")}
					disabled={!enabled.first}
					aria-label="Jump to first agent message">
					<MessageWedge
						direction="previous"
						jump
					/>
				</button>
				<button
					type="button"
					className="agent-hud__layout-direction agent-hud__message-direction"
					onClick={() => onNavigate("previous")}
					disabled={!enabled.previous}
					aria-label="Previous agent message">
					<MessageWedge direction="previous" />
				</button>
			</div>
			<span
				className="agent-hud__logo agent-hud__logo--actions"
				data-agent-state={agentActivityState}
				aria-hidden="true">
				A
			</span>
			<div className="agent-hud__message-nav-side">
				<button
					type="button"
					className="agent-hud__layout-direction agent-hud__message-direction"
					onClick={() => onNavigate("next")}
					disabled={!enabled.next}
					aria-label="Next agent message">
					<MessageWedge direction="next" />
				</button>
					<button
						type="button"
						className="agent-hud__layout-direction agent-hud__message-direction"
						onClick={() => onNavigate("latest")}
						disabled={!enabled.latest}
						aria-label="Jump to latest agent message">
						<MessageWedge
							direction="next"
							jump
						/>
					</button>
			</div>
		</div>
	)
}
