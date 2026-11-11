// The model selector is supplied by the caller; secrets are unlocked in a dialog.
// One row: the project badge on the left, the model and view selectors on the right;
// on the guide, the badge names onboarding and its button shows the guide's file;
// the theme toggle sits on the left edge (HudCornerControls).
import type { ReactNode } from "react"
import { openProjectFolder, showOnboardingFile } from "../../links/open-link"
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
				presentation.headerVariant === "overview"
					? "agent-hud__header--overview"
					: "agent-hud__header--row",
				presentation.showProjectBadge ? "agent-hud__header--project" : "",
			]
					.filter(Boolean)
					.join(" ")}>
			{!presentation.showProjectBadge ? null : presentation.screen === "onboarding" ? (
				<HudProjectBadge name="onboarding" folderLabel="Show onboarding file" onOpenFolder={showOnboardingFile} />
			) : (
				<HudProjectBadge name={projectSlug} folderLabel="Open project folder"
					onOpenFolder={() => { if (projectSlug) openProjectFolder(projectSlug) }} />
			)}
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
