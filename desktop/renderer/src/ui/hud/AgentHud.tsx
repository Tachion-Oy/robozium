// Frame markup copied from robozium-electron/desktop/web/app/components/hud/AgentHUD.tsx
// (lines 178-243) at 076b2c9, in its desktop configuration: no intro, minimize or
// resize handle. The caller supplies the message log pane and owns whether it is open.
import type { ReactNode } from "react"
import type { MessageLogState } from "../../log/useMessageLog"
import { HudCornerControls, moveLayoutMode, type LayoutMode } from "./HudCornerControls"
import { HudProjectBadge } from "./HudProjectBadge"
import type { HudPresentation } from "./hudPresentation"

export function AgentHud({ presentation, projectSlug, layoutMode, onLayoutModeChange, messageLog, logPane, header, children }: {
	presentation: HudPresentation
	projectSlug: string | null
	layoutMode: LayoutMode
	onLayoutModeChange: (mode: LayoutMode) => void
	messageLog: MessageLogState
	/** Rendered only while the log is open. */
	logPane: () => ReactNode
	header: ReactNode
	children: ReactNode
}) {
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
							showMinimize={false}
							disabled={!presentation.enableCornerControls}
							layout={{
								mode: layoutMode,
								onMove: (direction) =>
									onLayoutModeChange(moveLayoutMode(layoutMode, direction)),
								onMinimize: () => {},
							}}
						/>
						<button
							type="button"
							className="desktop-message-log-toggle agent-hud__corner-control"
							aria-label={messageLog.open ? "Hide message log" : "Show message log"}
							title={messageLog.open ? "Hide message log" : "Show message log"}
							aria-expanded={messageLog.open}
							aria-controls="desktop-message-log"
							onClick={messageLog.toggle}>
							<svg className="agent-hud__size-icon" viewBox="0 0 20 20" aria-hidden="true">
								<path d={messageLog.open ? "M12 5 7 10l5 5" : "M7 5l5 5-5 5"} />
							</svg>
						</button>
						{presentation.showProjectBadge ? (
							<HudProjectBadge projectSlug={projectSlug} />
						) : null}
						{header}
						{children}
					</div>
				</div>
				{messageLog.open && logPane()}
			</div>
		</div>
	)
}
