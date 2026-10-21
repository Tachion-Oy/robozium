import type { Dispatch, SetStateAction } from "react"
import type { Project } from "@/lib/robozium/wire"
import type { ReplyImagesModel } from "@/hooks/useReplyImages"
import { useStore } from "zustand"
import { hudVisibilityStore } from "@/lib/robozium/hud-visibility"
import type { HudNavigation, HudNavigationEvent, LaunchDraft } from "@/lib/robozium/hud-navigation"
import type { LayoutMode } from "./HudCornerControls"
import { RunHud } from "./run/RunHud"
import { ProjectOverview } from "./projects/ProjectOverview"
import { CapabilitySelector } from "./projects/CapabilitySelector"
import { EnvironmentPanel } from "./environment/EnvironmentPanel"
import { DependencyPanel } from "./dependencies/DependencyPanel"
import { OnboardingHud } from "./onboarding/OnboardingHud"
import type { HudPresentation } from "./hudPresentation"

type HudScreenContentProps = {
	presentation: HudPresentation
	runId: string | null
	replyDraft: string
	replyImages: ReplyImagesModel
	onReplyDraftChange: Dispatch<SetStateAction<string>>
	initialProjects: Project[] | null
	layoutMode: LayoutMode
	onReturnToRun: () => void
	projectsVisible?: boolean
	navigation: HudNavigation
	dispatch: Dispatch<HudNavigationEvent>
	onLaunch: (draft: LaunchDraft) => Promise<boolean>
	/** The first save during setup loaded API keys; unlock the HUD. */
	onSetupComplete?: () => Promise<void>
}

export function HudScreenContent({
	presentation,
	runId,
	replyDraft,
	replyImages,
	onReplyDraftChange,
	initialProjects,
	layoutMode,
	onReturnToRun,
	projectsVisible = true,
	navigation,
	dispatch,
	onLaunch,
	onSetupComplete,
}: HudScreenContentProps) {
	const pending = useStore(hudVisibilityStore, (state) => state.navigationPending)
	switch (presentation.screen) {
		case "projects":
			return projectsVisible ? (
				<ProjectOverview
					initialProjects={presentation.context === "landing" ? initialProjects : null}
					currentRunId={presentation.context === "active-run" ? runId : null}
					onCurrentProjectClick={presentation.context === "active-run" ? onReturnToRun : undefined}
					onSelectCapabilities={(project) => dispatch({ type: "launch_opened", project })}
					onLaunch={onLaunch}
					locked={presentation.locked}
					onStartHere={() => dispatch({ type: "screen_selected", screen: "onboarding" })}
				/>
			) : null
		case "launch":
			return projectsVisible && navigation.launch ? (
				<CapabilitySelector
					draft={navigation.launch}
					disabled={pending}
					onChange={(change) => dispatch({ type: "launch_changed", change })}
					onCancel={() => dispatch({ type: "launch_closed" })}
					onSubmit={(selection) => {
						if (navigation.launch) void onLaunch({ ...navigation.launch, selection })
					}}
				/>
			) : null
		case "environment":
			return <EnvironmentPanel onSetupComplete={presentation.locked ? onSetupComplete : undefined} />
		case "dependencies":
			return <DependencyPanel />
		case "onboarding":
			return (
				<div className="agent-hud__run-view">
					<OnboardingHud
						layoutMode={layoutMode}
						onExit={() => dispatch({ type: "screen_selected", screen: "projects" })}
					/>
				</div>
			)
		case "run":
			return runId ? (
				<div className="agent-hud__run-view">
					<RunHud
						key={runId}
						draft={replyDraft}
						images={replyImages}
						onDraftChange={onReplyDraftChange}
						layoutMode={layoutMode}
					/>
				</div>
			) : null
	}
}
