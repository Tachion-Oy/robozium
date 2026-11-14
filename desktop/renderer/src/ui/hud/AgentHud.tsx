// The HUD frame has no intro, minimize or resize handle. The caller supplies the message log pane and owns whether it is open.
// The right edge holds the message log toggle with the copy controls beneath it.
import { createContext, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import type { MessageLogState } from "../../log/useMessageLog"
import { HudCopyControls } from "../run/HudCopyControls"
import { HudCornerControls, moveLayoutMode, type LayoutMode } from "./HudCornerControls"
import { HudEdgeButton } from "./HudEdgeButton"
import type { HudPresentation } from "./hudPresentation"

// The right edge's copy controls element. The reply form renders its live copy controls
// into it with a portal, because the form holds the displayed message and the draft,
// and marks the slot filled while it does. An unfilled slot shows the same controls
// disabled, so the column never changes shape.
export const CopyControlsSlot = createContext<{ element: HTMLElement | null; setFilled: (filled: boolean) => void }>({
	element: null,
	setFilled: () => {},
})

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
	const [copySlotFilled, setCopySlotFilled] = useState(false)
	const copySlotValue = useMemo(() => ({ element: copySlot, setFilled: setCopySlotFilled }), [copySlot])
	const hud = useRef<HTMLDivElement>(null)
	const resizing = messageLog.resizingWidth
	const hudBoxClassName = `agent-hud__box${
		presentation.headerVariant === "overview"
			? " agent-hud__box--overview"
			: ""
	}${presentation.context === "recovery" ? " agent-hud__box--inactive" : ""}`

	return (
		<div className="desktop-workspace">
			<div
				className="desktop-workspace__panes"
				data-log-open={messageLog.open || undefined}
				data-log-resizing={resizing !== null || undefined}
				style={resizing === null ? undefined : { "--desktop-hud-width": `${resizing}px` } as CSSProperties}>
				<div
					ref={hud}
					className="agent-hud"
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
								disabled={resizing !== null}
								onClick={() => { if (hud.current) messageLog.toggle(hud.current.getBoundingClientRect().width) }}>
								<svg className="desktop-message-log-toggle__icon" viewBox="0 0 16 16" aria-hidden="true">
									<path d="M3 4.5h10M3 8h10M3 11.5h10" />
								</svg>
							</HudEdgeButton>
							<div ref={setCopySlot} className="desktop-edge-controls__copy" />
							{!copySlotFilled && (
								<HudCopyControls agentMessage={null} replyDraft="" disabled onClearReply={() => {}} />
							)}
						</div>
						{header}
						<CopyControlsSlot value={copySlotValue}>{children}</CopyControlsSlot>
					</div>
				</div>
				{messageLog.open && logPane()}
			</div>
		</div>
	)
}
