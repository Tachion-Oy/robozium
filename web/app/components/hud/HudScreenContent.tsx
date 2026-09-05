import type { Dispatch, SetStateAction } from "react"
import type { Project } from "@/lib/robosprawl/wire"
import type { LayoutMode } from "./HudCornerControls"
import { RunHud } from "./run/RunHud"
import { ProjectOverview } from "./projects/ProjectOverview"
import { DependencyPanel } from "./dependencies/DependencyPanel"
import type { HudPresentation } from "./hudPresentation"

type HudScreenContentProps = {
	presentation: HudPresentation
	runId: string | null
	replyDraft: string
	onReplyDraftChange: Dispatch<SetStateAction<string>>
	projectSlug: string | null
	initialProjects: Project[] | null
	layoutMode: LayoutMode
	onReturnToRun: () => void
}

export function HudScreenContent({
	presentation,
	runId,
	replyDraft,
	onReplyDraftChange,
	projectSlug,
	initialProjects,
	layoutMode,
	onReturnToRun,
}: HudScreenContentProps) {
	if (presentation.screen === "dependencies") return <DependencyPanel />

	if (presentation.screen === "projects") {
		return (
			<ProjectOverview
				initialProjects={
					presentation.context === "landing" ? initialProjects : null
				}
				currentProjectSlug={
					presentation.context === "active-run" ? projectSlug : null
				}
				onCurrentProjectClick={
					presentation.context === "active-run" ? onReturnToRun : undefined
				}
			/>
		)
	}

	if (presentation.screen === "run" && runId) {
		return (
			<div className="agent-hud__run-view">
				<RunHud
					key={runId}
					draft={replyDraft}
					onDraftChange={onReplyDraftChange}
					layoutMode={layoutMode}
				/>
			</div>
		)
	}

	return null
}
