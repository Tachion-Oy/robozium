// Copied from web/app/components/hud/projects/ProjectOverview.tsx at 5b06d82.
// Adapted: the listing, the cancel and delete owner, the launch lock and run
// opening arrive as props instead of the navigation store, router and client;
// a launch already in flight refuses another. A first listing that fails is
// reported in a toast with Retry instead of showing an empty hub. Only the row's Open
// button opens a run; the row itself is not a button.
import {
	isActiveRunStatus,
	isCurrentRunRow,
	ProjectStatus,
	type ProjectRow,
} from "../../projects/landing"
import type { ProjectQueryState } from "../../projects/useProjectQuery"
import type { ProjectMutations } from "../../projects/useProjectMutations"
import type { LaunchDraft } from "../../app/hud-navigation"
import { usePersistentToast } from "../../feedback/notices"
import { ProjectOverviewPanel } from "./ProjectOverviewPanel"

type ProjectOverviewProps = {
	projects: ProjectQueryState
	mutations: Pick<ProjectMutations, "cancel" | "remove">
	navigationPending: boolean
	isLaunching: () => boolean
	currentRunId?: string | null
	onCurrentProjectClick?: () => void
	onOpenRun: (runId: string, project: string) => void
	onSelectCapabilities: (project: string | null) => void
	onLaunch: (draft: LaunchDraft) => Promise<boolean>
	/** API keys are missing: rows are disabled and Start Here opens the guide. */
	locked?: boolean
	onStartHere?: () => void
}

export function ProjectOverview({
	projects,
	mutations,
	navigationPending,
	isLaunching,
	currentRunId = null,
	onCurrentProjectClick,
	onOpenRun,
	onSelectCapabilities,
	onLaunch,
	locked = false,
	onStartHere,
}: ProjectOverviewProps) {
	usePersistentToast("projects", projects.loadError === null ? null : {
		tone: "error",
		title: "Could not load projects",
		message: projects.loadError,
		actions: [{ label: "Retry", onClick: projects.refresh }],
	})
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
	// The toast reports the failure; the view stays empty rather than claiming no projects.
	if (projects.loadError !== null) return <div className="agent-hud__project-view agent-hud__overview-loading" />
	const openSelector = (project: string | null) => {
		if (!navigationPending) onSelectCapabilities(project)
	}

	const handleLaunch = async (project: ProjectRow) => {
		if (
			navigationPending || isLaunching() ||
			project.status !== ProjectStatus.Dormant || project.runId !== null
		) return
		await onLaunch({ project: project.slug, name: project.slug, selection: null })
	}

	const handleOpen = (project: ProjectRow) => {
		if (navigationPending) return
		if (isCurrentRunRow(project, currentRunId) && onCurrentProjectClick) {
			onCurrentProjectClick()
			return
		}
		if (isActiveRunStatus(project.status) && project.runId) {
			onOpenRun(project.runId, project.slug)
		}
	}

	return (
		<ProjectOverviewPanel
			projects={projects.rows}
			currentRunId={currentRunId}
			navigationPending={navigationPending}
			locked={locked}
			onStartHere={onStartHere}
			onOpenProject={handleOpen}
			onSelectCapabilities={(project) => openSelector(project.slug)}
			onLaunchProject={handleLaunch}
			onNewProject={() => openSelector(null)}
			onCancelRun={(project) => void mutations.cancel(project.slug)}
			onDeleteProject={(project) => void mutations.remove(project.slug)}
		/>
	)
}
