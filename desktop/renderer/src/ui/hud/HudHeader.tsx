// The model selector is supplied by the caller; secrets are unlocked in a dialog.
// One row: the project badge on the left; the model and view selectors on the right,
// then a button that shows the badge's files in the file manager. On the guide, the
// badge names onboarding and the button shows the guide's file. The theme toggle sits
// on the left edge (HudCornerControls).
import type { ReactNode } from "react"
import { openProjectFolder, showOnboardingFile } from "../../links/open-link"
import { HudEdgeButton } from "./HudEdgeButton"
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
	// A run's name is null until its project is known; the button waits for it.
	const badge = presentation.screen === "onboarding"
		? { name: "onboarding", folderLabel: "Show onboarding file", openFolder: showOnboardingFile }
		: {
			name: projectSlug,
			folderLabel: "Open project folder",
			openFolder: () => { if (projectSlug) openProjectFolder(projectSlug) },
		}
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
			{presentation.showProjectBadge ? <HudProjectBadge name={badge.name} /> : null}
			<div className="agent-hud__header-actions flex shrink-0 items-start gap-(--hud-actions-gap)">
				{modelSelector}
				<HudScreenSelector
					screen={presentation.screen}
					options={presentation.screenOptions}
					onSelectScreen={onSelectScreen}
				/>
				{presentation.showProjectBadge ? (
					<HudEdgeButton
						variant="icon"
						className="agent-hud__project-folder"
						disabled={!badge.name}
						onClick={badge.openFolder}
						aria-label={badge.folderLabel}
						title={badge.folderLabel}>
						<svg className="agent-hud__copy-text-icon" viewBox="0 0 24 24" aria-hidden="true">
							<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.25l2 2.5h8.75A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5Z" />
							<path d="M3 11h18" />
						</svg>
					</HudEdgeButton>
				) : null}
			</div>
		</div>
	)
}
