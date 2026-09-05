import type { Dispatch, SetStateAction } from "react"
import type { Project } from "@/lib/robosprawl/wire"
import type { LayoutMode } from "./HudControls"
import { LandingHud } from "./LandingHud"
import { RunHud } from "./RunHud"
import { StatusPanel } from "./StatusPanel"

export type HudView = "main" | "dependencies" | "agents"
export type RecoveryView = "dependencies" | "agents"

type AgentHudViewProps = {
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

export function AgentHudView({
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
}: AgentHudViewProps) {
	if (view === "dependencies") return <StatusPanel />

	if (view === "agents" && !isLanding) {
		return (
			<LandingHud
				initialProjects={null}
				currentProjectSlug={isRecovery ? null : projectSlug}
				onCurrentProjectClick={isRecovery ? undefined : onReturnToRun}
			/>
		)
	}

	if (view === "main" && isLanding) {
		return <LandingHud initialProjects={initialProjects} />
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
