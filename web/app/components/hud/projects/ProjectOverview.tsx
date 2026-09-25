"use client"

import { useStore } from "zustand"
import { useRouter } from "next/navigation"
import { hudVisibilityStore } from "@/lib/robozium/hud-visibility"
import {
	AgentApiError,
	cancelProject,
	createProject,
	createRun,
	deleteProject,
} from "@/lib/robozium/client"
import {
	isActiveRunStatus,
	isCurrentRunRow,
	ProjectStatus,
	type ProjectRow,
} from "@/lib/robozium/landing"
import type { Project } from "@/lib/robozium/wire"
import { showErrorToast } from "@/app/components/feedback/ErrorToast"
import { ProjectOverviewPanel } from "./ProjectOverviewPanel"
import { useProjectOverview } from "./useProjectOverview"

type ProjectOverviewProps = {
	/** Server-fetched seed so the table paints on first render. */
	initialProjects?: Project[] | null
	currentRunId?: string | null
	onCurrentProjectClick?: () => void
}

export function ProjectOverview({
	initialProjects = null,
	currentRunId = null,
	onCurrentProjectClick,
}: ProjectOverviewProps) {
	const router = useRouter()
	const navigationPending = useStore(
		hudVisibilityStore,
		(state) => state.navigationPending,
	)
	const projects = useProjectOverview(initialProjects)
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
	const beginNavigation = () => {
		if (hudVisibilityStore.getState().navigationPending) return false
		hudVisibilityStore.setState({ navigationPending: true })
		return true
	}
	const releaseNavigation = () => {
		hudVisibilityStore.setState({ navigationPending: false })
	}

	const handleCreateRunSubmit = async (projectName: string) => {
		if (!beginNavigation()) return
		try {
			const { slug: project } = await createProject({ name: projectName })
			const { run_id } = await createRun({ project })
			router.push(`/?runId=${encodeURIComponent(run_id)}`)
		} catch (error) {
			if (error instanceof AgentApiError && error.status === 423) {
				releaseNavigation()
				showErrorToast({
					title: "API keys locked",
					message: "Unlock API keys before starting a run.",
					detail: "Open the API keys locked menu and enter your password.",
				})
			} else {
				router.push("/?error=Unable%20to%20start%20run")
			}
		}
	}

	const handleCancelRun = async (project: ProjectRow) => {
		projects.markCancelling(project.slug)
		try {
			const { ok } = await cancelProject(project.slug)
			if (!ok) {
				projects.clearCancelling(project.slug)
				showErrorToast({
					title: "Cancellation failed",
					message: `Could not cancel "${project.slug}".`,
					detail: "The project is still active. Try again.",
				})
			}
		} catch {
			projects.clearCancelling(project.slug)
			showErrorToast({
				title: "Cancellation failed",
				message: `Could not cancel "${project.slug}".`,
				detail: "The cancellation request failed. Try again.",
			})
		} finally {
			projects.refresh()
		}
	}

	const handleDeleteProject = async (project: ProjectRow) => {
		projects.markDeleting(project.slug)
		try {
			await deleteProject(project.slug)
			projects.remove(project.slug)
		} catch {
			projects.clearDeleting(project.slug)
			showErrorToast({
				title: "Deletion failed",
				message: `Could not delete "${project.slug}".`,
				detail: "The project was not deleted. Try again.",
			})
		} finally {
			projects.refresh()
		}
	}

	const handleProjectClick = async (project: ProjectRow) => {
		if (hudVisibilityStore.getState().navigationPending) return
		if (isCurrentRunRow(project, currentRunId) && onCurrentProjectClick) {
			onCurrentProjectClick()
			return
		}
		if (isActiveRunStatus(project.status) && project.runId) {
			if (!beginNavigation()) return
			projects.markOpening(project.slug)
			router.push(`/?runId=${encodeURIComponent(project.runId)}`)
			return
		}
		if (
			project.status !== ProjectStatus.Dormant ||
			project.runId !== null
		)
			return
		if (!beginNavigation()) return
		projects.markOpening(project.slug)
		try {
			const { run_id } = await createRun({ project: project.slug })
			router.push(`/?runId=${encodeURIComponent(run_id)}`)
		} catch (error) {
			projects.clearOpening(project.slug)
			if (error instanceof AgentApiError && error.status === 423) {
				releaseNavigation()
				showErrorToast({
					title: "API keys locked",
					message: "Unlock API keys before starting a run.",
					detail: "Open the API keys locked menu and enter your password.",
				})
			} else {
				router.push("/?error=Unable%20to%20resume%20project")
			}
		}
	}

	return (
		<ProjectOverviewPanel
			projects={projects.rows}
			currentRunId={currentRunId}
			navigationPending={navigationPending}
			onProjectClick={handleProjectClick}
			onCreateRunSubmit={handleCreateRunSubmit}
			onCancelRun={handleCancelRun}
			onDeleteProject={handleDeleteProject}
		/>
	)
}
