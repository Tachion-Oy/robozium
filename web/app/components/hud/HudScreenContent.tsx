import type { Dispatch, SetStateAction } from "react"
import type { Project } from "@/lib/robosprawl/wire"
import type { LayoutMode } from "./HudCornerControls"
import { ProjectOverview } from "./projects/ProjectOverview"
import { RunHud } from "./run/RunHud"
import { DependencyPanel } from "./dependencies/DependencyPanel"

export type HudView = "main" | "dependencies" | "agents"
export type RecoveryView = "dependencies" | "agents"

type HudScreenContentProps = {
	view: HudView
	isLanding: boolean
	isRecovery: boolean
	runId: string | null
	replyDraft: string
	onReplyDraftChange: Dispatch<SetStateAction<string>>
	projectSlug: string | null
	initialProjects: Project[] | null
	layoutMode: LayoutMode
	onReturnToRun: () => void
}

export function HudScreenContent({
	view,
	isLanding,
	isRecovery,
	runId,
	replyDraft,
	onReplyDraftChange,
	projectSlug,
	initialProjects,
	layoutMode,
	onReturnToRun,
}: HudScreenContentProps) {
	if (view === "dependencies") return <DependencyPanel />

	if (view === "agents" && !isLanding) {
		return (
			<ProjectOverview
				initialProjects={null}
				currentProjectSlug={isRecovery ? null : projectSlug}
				onCurrentProjectClick={isRecovery ? undefined : onReturnToRun}
			/>
		)
	}

	if (view === "main" && isLanding) {
		return <ProjectOverview initialProjects={initialProjects} />
	}

	if (view === "main" && runId) {
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
