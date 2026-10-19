// Frame markup copied from robozium-electron/desktop/web/app/components/hud/AgentHUD.tsx
// (lines 178-243) at 076b2c9, in its desktop configuration: no intro, minimize or
// resize handle. The message log and its toggle follow in roadmap step 13.
import type { ReactNode } from "react"
import { HudCornerControls, moveLayoutMode, type LayoutMode } from "./HudCornerControls"
import { HudProjectBadge } from "./HudProjectBadge"
import type { HudPresentation } from "./hudPresentation"

export function AgentHud({ presentation, projectSlug, layoutMode, onLayoutModeChange, header, children }: {
	presentation: HudPresentation
	projectSlug: string | null
	layoutMode: LayoutMode
	onLayoutModeChange: (mode: LayoutMode) => void
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
			<div className="desktop-workspace__panes">
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
						{presentation.showProjectBadge ? (
							<HudProjectBadge projectSlug={projectSlug} />
						) : null}
						{header}
						{children}
					</div>
				</div>
			</div>
		</div>
	)
}
