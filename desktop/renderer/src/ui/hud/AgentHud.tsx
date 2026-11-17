// The HUD fills its pane. The caller supplies the message log pane and owns whether it is open.
// The right edge holds the message log toggle with the copy controls beneath it.
import { useRef, type CSSProperties, type ReactNode } from "react"
import type { MessageLogState } from "../../log/useMessageLog"
import { HudCopyControls } from "../run/HudCopyControls"
import { HudCornerControls, moveLayoutMode, type LayoutMode } from "./HudCornerControls"
import { HudEdgeButton } from "./HudEdgeButton"
import { hasOverviewLayout, type HudScreen } from "../../app/hud-navigation"

export function AgentHud({ screen, inactive, layoutMode, onLayoutModeChange, messageLog, logPane, header, copyControls, children }: {
	screen: HudScreen
	/** The displayed run has ended or gone missing. */
	inactive: boolean
	layoutMode: LayoutMode
	onLayoutModeChange: (mode: LayoutMode) => void
	messageLog: MessageLogState
	/** Rendered only while the log is open. */
	logPane: () => ReactNode
	header: ReactNode
	/** The screen's copy and clear buttons. Without any, the column shows the same buttons disabled, so it never changes shape. */
	copyControls: ReactNode
	children: ReactNode
}) {
	const hud = useRef<HTMLDivElement>(null)
	const resizing = messageLog.resizingWidth
	const hudBoxClassName = `agent-hud__box${
		hasOverviewLayout(screen)
			? " agent-hud__box--overview"
			: ""
	}${inactive ? " agent-hud__box--inactive" : ""}`

	return (
		<div className="workspace">
			<div
				className="workspace__panes"
				data-log-open={messageLog.open || undefined}
				data-log-resizing={resizing !== null || undefined}
				style={resizing === null ? undefined : { "--workspace-hud-width": `${resizing}px` } as CSSProperties}>
				<div
					ref={hud}
					className="agent-hud"
					aria-live="polite">
					<div className={hudBoxClassName}>
						<HudCornerControls
							disabled={screen !== "run"}
							layout={{
								mode: layoutMode,
								onMove: (direction) =>
									onLayoutModeChange(moveLayoutMode(layoutMode, direction)),
							}}
						/>
						<div className="edge-controls">
							<HudEdgeButton
								variant="toggle"
								className="message-log-toggle"
								aria-label={messageLog.open ? "Hide message log" : "Show message log"}
								title={messageLog.open ? "Hide message log" : "Show message log"}
								aria-expanded={messageLog.open}
								aria-controls="message-log"
								disabled={resizing !== null}
								onClick={() => { if (hud.current) messageLog.toggle(hud.current.getBoundingClientRect().width) }}>
								<svg className="message-log-toggle__icon" viewBox="0 0 16 16" aria-hidden="true">
									<path d="M3 4.5h10M3 8h10M3 11.5h10" />
								</svg>
							</HudEdgeButton>
							<span className="agent-hud__edge-divider" aria-hidden="true" />
							<div className="edge-controls__copy">{copyControls}</div>
							{!copyControls && (
								<HudCopyControls message={null} replyDraft="" hasAttachments={false} disabled onClearReply={() => {}} />
							)}
						</div>
						{header}
						{children}
					</div>
				</div>
				{messageLog.open && logPane()}
			</div>
		</div>
	)
}
