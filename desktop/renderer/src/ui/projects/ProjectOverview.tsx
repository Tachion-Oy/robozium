// Copied from web/app/components/hud/projects/ProjectOverview.tsx at 5b06d82.
// Adapted: the overview owner, the launch lock and run opening arrive as props
// instead of the navigation store, router and client; a launch already in
// flight refuses another before it marks a row. A first listing that fails is
// reported with Retry instead of showing an empty hub.
import {
	isActiveRunStatus,
	isCurrentRunRow,
	ProjectStatus,
	type ProjectRow,
} from "../../projects/landing"
import type { ProjectQueryState } from "../../projects/useProjectQuery"
import type { LaunchDraft } from "../../app/hud-navigation"
import { HudButton } from "../hud/HudButton"
import { ProjectOverviewPanel } from "./ProjectOverviewPanel"

type ProjectOverviewProps = {
	projects: ProjectQueryState
	navigationPending: boolean
	isLaunching: () => boolean
	currentRunId?: string | null
	onCurrentProjectClick?: () => void
	onOpenRun: (runId: string, project: string) => void
	onSelectCapabilities: (project: string | null) => void
	onLaunch: (draft: LaunchDraft) => Promise<boolean>
}

export function ProjectOverview({
	projects,
	navigationPending,
	isLaunching,
	currentRunId = null,
	onCurrentProjectClick,
	onOpenRun,
	onSelectCapabilities,
	onLaunch,
}: ProjectOverviewProps) {
	if (projects.isInitialLoading) {
		return (
			<div
				className="agent-hud__project-view agent-hud__overview-loading"
				role="status">
				<span>Refreshing project status</span>
				<span
					className="agent-hud__overview-loading-dots"
					aria-hidden="true">
					...
				</span>
			</div>
		)
	}
	if (projects.loadError !== null) {
		return (
			<div
				className="agent-hud__project-view agent-hud__overview-loading"
				role="alert">
				<span>Could not load projects: {projects.loadError}</span>
				<HudButton onClick={projects.refresh}>Retry</HudButton>
			</div>
		)
	}
	const openSelector = (project: string | null) => {
		if (!navigationPending) onSelectCapabilities(project)
	}

	const handleLaunch = async (project: ProjectRow) => {
		if (
			navigationPending || isLaunching() ||
			project.status !== ProjectStatus.Dormant || project.runId !== null
		) return
		projects.markOpening(project.slug)
		const launched = await onLaunch({ project: project.slug, name: project.slug, selection: null })
		projects.clearOpening(project.slug)
		if (!launched) projects.refresh()
	}

	const handleProjectClick = (project: ProjectRow) => {
		if (navigationPending) return
		if (isCurrentRunRow(project, currentRunId) && onCurrentProjectClick) {
			onCurrentProjectClick()
			return
		}
		if (isActiveRunStatus(project.status) && project.runId) {
			onOpenRun(project.runId, project.slug)
			return
		}
		if (
			project.status !== ProjectStatus.Dormant ||
			project.runId !== null
		)
			return
		openSelector(project.slug)
	}

	return (
		<ProjectOverviewPanel
			projects={projects.rows}
			currentRunId={currentRunId}
			navigationPending={navigationPending}
			onProjectClick={handleProjectClick}
			onSelectCapabilities={(project) => openSelector(project.slug)}
			onLaunchProject={handleLaunch}
			onNewProject={() => openSelector(null)}
			onCancelRun={(project) => void projects.cancel(project.slug)}
			onDeleteProject={(project) => void projects.remove(project.slug)}
		/>
	)
}
