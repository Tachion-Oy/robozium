"use client"

import { useStore } from "zustand"
import { useRouter } from "next/navigation"
import { beginHudNavigation, hudVisibilityStore } from "@/lib/robozium/hud-visibility"
import {
	cancelProject,
	deleteProject,
} from "@/lib/robozium/client"
import {
	isActiveRunStatus,
	isCurrentRunRow,
	ProjectStatus,
	type ProjectRow,
} from "@/lib/robozium/landing"
import type { Project } from "@/lib/robozium/wire"
import type { LaunchDraft } from "@/lib/robozium/hud-navigation"
import { showErrorToast } from "@/app/components/feedback/ErrorToast"
import { ProjectOverviewPanel } from "./ProjectOverviewPanel"
import { useProjectOverview } from "./useProjectOverview"

type ProjectOverviewProps = {
	/** Server-fetched seed so the table paints on first render. */
	initialProjects?: Project[] | null
	currentRunId?: string | null
	onCurrentProjectClick?: () => void
	onSelectCapabilities: (project: string | null) => void
	onLaunch: (draft: LaunchDraft) => Promise<boolean>
}

export function ProjectOverview({
	initialProjects = null,
	currentRunId = null,
	onCurrentProjectClick,
	onSelectCapabilities,
	onLaunch,
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
	const openSelector = (project: string | null) => {
		if (!hudVisibilityStore.getState().navigationPending) onSelectCapabilities(project)
	}

	const handleLaunch = async (project: ProjectRow) => {
		if (
			hudVisibilityStore.getState().navigationPending ||
			project.status !== ProjectStatus.Dormant || project.runId !== null
		) return
		projects.markOpening(project.slug)
		const launched = await onLaunch({ project: project.slug, name: project.slug, capabilities: null })
		if (!launched) {
			projects.clearOpening(project.slug)
			projects.refresh()
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

	const handleProjectClick = (project: ProjectRow) => {
		if (hudVisibilityStore.getState().navigationPending) return
		if (isCurrentRunRow(project, currentRunId) && onCurrentProjectClick) {
			onCurrentProjectClick()
			return
		}
		if (isActiveRunStatus(project.status) && project.runId) {
			if (!beginHudNavigation()) return
			projects.markOpening(project.slug)
			router.push(`/?runId=${encodeURIComponent(project.runId)}`)
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
			onCancelRun={handleCancelRun}
			onDeleteProject={handleDeleteProject}
		/>
	)
}
