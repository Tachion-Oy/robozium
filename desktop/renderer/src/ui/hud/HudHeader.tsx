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
import { hasOverviewLayout, type HudScreen, type HudScreenOption } from "../../app/hud-navigation"

type HudHeaderProps = {
	screen: HudScreen
	screenOptions: readonly HudScreenOption[]
	projectSlug: string | null
	modelSelector: ReactNode
	onSelectScreen: (screen: HudScreen) => void
}

export function HudHeader({
	screen,
	screenOptions,
	projectSlug,
	modelSelector,
	onSelectScreen,
}: HudHeaderProps) {
	// The project name labels the run on Current Run; elsewhere it would look like the screen's subject.
	// The guide is its own subject: its badge leads to the guide's file.
	const showProjectBadge = screen === "run" || screen === "onboarding"
	// A run's name is null until its project is known; the button waits for it.
	const badge = screen === "onboarding"
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
				hasOverviewLayout(screen)
					? "agent-hud__header--overview"
					: "agent-hud__header--row",
				showProjectBadge ? "agent-hud__header--project" : "",
			]
					.filter(Boolean)
					.join(" ")}>
			{showProjectBadge ? <HudProjectBadge name={badge.name} /> : null}
			<div className="agent-hud__header-actions">
				{modelSelector}
				<HudScreenSelector
					screen={screen}
					options={screenOptions}
					onSelectScreen={onSelectScreen}
				/>
				{showProjectBadge ? (
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
