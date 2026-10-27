// Frame markup copied from robozium-electron/desktop/web/app/components/hud/AgentHUD.tsx
// (lines 178-243) at 076b2c9, in its desktop configuration: no intro, minimize or
// resize handle. The caller supplies the message log pane and owns whether it is open.
// The right edge holds the message log toggle with the copy controls beneath it.
import { createContext, useState, type ReactNode } from "react"
import type { MessageLogState } from "../../log/useMessageLog"
import { HudCopyControls } from "../run/HudCopyControls"
import { HudCornerControls, moveLayoutMode, type LayoutMode } from "./HudCornerControls"
import { HudEdgeButton } from "./HudEdgeButton"
import type { HudPresentation } from "./hudPresentation"

// The right edge's copy controls element. The reply form renders its live copy controls
// into it with a portal, because the form holds the displayed message and the draft.
// Without a reply form AgentHud shows the same controls disabled, so the column never
// changes shape.
export const CopyControlsSlot = createContext<HTMLElement | null>(null)

export function AgentHud({ presentation, layoutMode, onLayoutModeChange, messageLog, logPane, header, children }: {
	presentation: HudPresentation
	layoutMode: LayoutMode
	onLayoutModeChange: (mode: LayoutMode) => void
	messageLog: MessageLogState
	/** Rendered only while the log is open. */
	logPane: () => ReactNode
	header: ReactNode
	children: ReactNode
}) {
	const [copySlot, setCopySlot] = useState<HTMLElement | null>(null)
	const isLanding = presentation.context === "landing"
	const hudBoxClassName = `agent-hud__box${
		presentation.headerVariant === "landing"
			? " agent-hud__box--landing"
			: ""
	}${presentation.context === "recovery" ? " agent-hud__box--inactive" : ""}`
	const hudClassName = [
		"agent-hud",
		isLanding ? "agent-hud--landing" : "",
		!isLanding ? "agent-hud--fade" : "",
	]
		.filter(Boolean)
		.join(" ")

	return (
		<div className="desktop-workspace">
			<div className="desktop-workspace__panes" data-log-open={messageLog.open || undefined}>
				<div
					className={hudClassName}
					aria-live="polite">
					<div className={hudBoxClassName}>
						<HudCornerControls
							disabled={!presentation.enableCornerControls}
							layout={{
								mode: layoutMode,
								onMove: (direction) =>
									onLayoutModeChange(moveLayoutMode(layoutMode, direction)),
							}}
						/>
						<div className="desktop-edge-controls">
							<HudEdgeButton
								variant="toggle"
								className="desktop-message-log-toggle"
								aria-label={messageLog.open ? "Hide message log" : "Show message log"}
								title={messageLog.open ? "Hide message log" : "Show message log"}
								aria-expanded={messageLog.open}
								aria-controls="desktop-message-log"
								disabled={messageLog.pending}
								onClick={messageLog.toggle}>
								<svg className="desktop-message-log-toggle__icon" viewBox="0 0 16 16" aria-hidden="true">
									<path d="M3 4.5h10M3 8h10M3 11.5h10" />
								</svg>
							</HudEdgeButton>
							<div ref={setCopySlot} className="desktop-edge-controls__copy" />
							{presentation.screen !== "run" && (
								<HudCopyControls agentMessage={null} replyDraft="" disabled onClearReply={() => {}} />
							)}
						</div>
						{header}
						<CopyControlsSlot value={copySlot}>{children}</CopyControlsSlot>
					</div>
				</div>
				{messageLog.open && logPane()}
			</div>
		</div>
	)
}
