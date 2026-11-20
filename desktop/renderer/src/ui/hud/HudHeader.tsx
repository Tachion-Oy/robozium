// The model selector is supplied by the caller; secrets are unlocked in a dialog.
// One row: the run selector on the left; the model and view selectors on the right,
// then a button that shows the run's files in the file manager. On the guide, a
// badge names onboarding and the button shows the guide's file. The theme toggle sits
// on the left edge (HudCornerControls).
import type { ReactNode } from "react"
import { openProjectFolder, showOnboardingFile } from "../../links/open-link"
import { HudEdgeButton } from "./HudEdgeButton"
import { HudBadge } from "./HudBadge"
import { HudScreenSelector } from "./HudScreenSelector"
import { hasOverviewLayout, type HudScreen, type HudScreenOption } from "../../app/hud-navigation"

type HudHeaderProps = {
	screen: HudScreen
	screenOptions: readonly HudScreenOption[]
	projectSlug: string | null
	runSelector: ReactNode
	modelSelector: ReactNode
	onSelectScreen: (screen: HudScreen) => void
}

export function HudHeader({
	screen,
	screenOptions,
	projectSlug,
	runSelector,
	modelSelector,
	onSelectScreen,
}: HudHeaderProps) {
	// The run selector names the run on Current Runs; elsewhere it would look like the screen's subject.
	// The guide is its own subject: its badge leads to the guide's file.
	const onboarding = screen === "onboarding"
	const showSubject = screen === "run" || onboarding
	let subject = runSelector
	// A run's name is null until its project is known; the button waits for it.
	let folder = {
		available: projectSlug !== null,
		label: "Open project folder",
		open: () => { if (projectSlug) openProjectFolder(projectSlug) },
	}
	if (onboarding) {
		subject = <div className="agent-hud__event-edge"><HudBadge>onboarding</HudBadge></div>
		folder = { available: true, label: "Show onboarding file", open: showOnboardingFile }
	}
	return (
		<div
			className={[
				"agent-hud__header",
				hasOverviewLayout(screen)
					? "agent-hud__header--overview"
					: "agent-hud__header--row",
				showSubject ? "agent-hud__header--project" : "",
			]
					.filter(Boolean)
					.join(" ")}>
			{showSubject ? subject : null}
			<div className="agent-hud__header-actions">
				{modelSelector}
				<HudScreenSelector
					screen={screen}
					options={screenOptions}
					onSelectScreen={onSelectScreen}
				/>
				{showSubject ? (
					<HudEdgeButton
						variant="icon"
						className="agent-hud__project-folder"
						disabled={!folder.available}
						onClick={folder.open}
						aria-label={folder.label}
						title={folder.label}>
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
