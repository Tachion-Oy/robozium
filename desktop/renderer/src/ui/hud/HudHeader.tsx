// Copied from web/app/components/hud/HudHeader.tsx at a664db2.
// Adapted: the model selector is supplied by the caller; secrets are unlocked in a dialog.
// One row: the project badge on the left, the model and view selectors on the right;
// the theme toggle sits on the left edge (HudCornerControls).
// The setup lock follows web at af87bea.
import type { ReactNode } from "react"
import { HudProjectBadge } from "./HudProjectBadge"
import { HudScreenSelector } from "./HudScreenSelector"
import type { HudPresentation, HudScreen } from "./hudPresentation"

type HudHeaderProps = {
	presentation: HudPresentation
	projectSlug: string | null
	modelSelector: ReactNode
	onSelectScreen: (screen: HudScreen) => void
}

export function HudHeader({
	presentation,
	projectSlug,
	modelSelector,
	onSelectScreen,
}: HudHeaderProps) {
	return (
		<div
			className={[
				"agent-hud__header",
				presentation.headerVariant === "landing"
					? "agent-hud__header--landing"
					: "agent-hud__header--row",
				presentation.showProjectBadge ? "agent-hud__header--project" : "",
				presentation.context === "active-run" && presentation.screen === "projects"
					? "agent-hud__header--runs-overview"
					: "",
			]
					.filter(Boolean)
					.join(" ")}>
			{presentation.showProjectBadge ? (
				<HudProjectBadge projectSlug={projectSlug} />
			) : null}
			<div className="agent-hud__header-actions flex shrink-0 items-start gap-(--hud-actions-gap)">
				{modelSelector}
				<HudScreenSelector
					screen={presentation.screen}
					options={presentation.screenOptions}
					onSelectScreen={onSelectScreen}
				/>
			</div>
		</div>
	)
}
