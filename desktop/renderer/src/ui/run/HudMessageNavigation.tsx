// Copied from web/app/components/hud/run/HudMessageNavigation.tsx at 86ef5c1.
// Adapted: types come from ./run-view, and the Robozium mark replaces the "A".
import type {
	AgentActivityState,
	HudMessageNavigationDirection,
} from "./run-view"
import { MessageWedge } from "./MessageWedge"
import { AgentIndicator } from "../branding/RoboziumMark"
import { HudEdgeButton } from "../hud/HudEdgeButton"

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
				<HudEdgeButton
					variant="arrow"
					className="agent-hud__message-direction"
					onClick={() => onNavigate("first")}
					disabled={!enabled.first}
					aria-label="Jump to first agent message">
					<MessageWedge
						direction="previous"
						jump
					/>
				</HudEdgeButton>
				<HudEdgeButton
					variant="arrow"
					className="agent-hud__message-direction"
					onClick={() => onNavigate("previous")}
					disabled={!enabled.previous}
					aria-label="Previous agent message">
					<MessageWedge direction="previous" />
				</HudEdgeButton>
			</div>
			<AgentIndicator className="agent-hud__logo--actions" agentActivityState={agentActivityState} />
			<div className="agent-hud__message-nav-side">
				<HudEdgeButton
					variant="arrow"
					className="agent-hud__message-direction"
					onClick={() => onNavigate("next")}
					disabled={!enabled.next}
					aria-label="Next agent message">
					<MessageWedge direction="next" />
				</HudEdgeButton>
				<HudEdgeButton
					variant="arrow"
					className="agent-hud__message-direction"
					onClick={() => onNavigate("latest")}
					disabled={!enabled.latest}
					aria-label="Jump to latest agent message">
					<MessageWedge
						direction="next"
						jump
					/>
				</HudEdgeButton>
			</div>
		</div>
	)
}
