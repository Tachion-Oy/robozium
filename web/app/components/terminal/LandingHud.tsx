"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
	cancelProject,
	createProject,
	createRun,
	deleteProject,
} from "@/lib/robosprawl/client"
import { ProjectStatus, type ProjectRow } from "@/lib/robosprawl/landing"
import type { Project } from "@/lib/robosprawl/wire"
import { showErrorToast } from "../feedback/ErrorToast"
import { LandingPanel } from "./LandingPanel"
import { useLandingProjects } from "./useLandingProjects"

type LandingHudProps = {
	/** Server-fetched seed so the table paints on first render. */
	initialProjects?: Project[] | null
	currentProjectSlug?: string | null
	onCurrentProjectClick?: () => void
}

export function LandingHud({
	initialProjects = null,
	currentProjectSlug = null,
	onCurrentProjectClick,
}: LandingHudProps) {
	const router = useRouter()
	const [isStarting, setIsStarting] = useState(false)
	const navigationPendingRef = useRef(false)
	const projects = useLandingProjects(initialProjects)
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
		if (navigationPendingRef.current) return false
		navigationPendingRef.current = true
		setIsStarting(true)
		return true
	}
	const releaseNavigation = () => {
		navigationPendingRef.current = false
		setIsStarting(false)
	}

	const handleCreateRunSubmit = async (projectName: string) => {
		if (!beginNavigation()) return
		try {
			const { slug: project } = await createProject({ name: projectName })
			const { run_id } = await createRun({ project })
			router.push(`/?runId=${encodeURIComponent(run_id)}`)
		} catch {
			releaseNavigation()
			router.push("/?error=Unable%20to%20start%20run")
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
		if (navigationPendingRef.current) return
		if (project.slug === currentProjectSlug && onCurrentProjectClick) {
			onCurrentProjectClick()
			return
		}
		if (
			(project.status === ProjectStatus.Running ||
				project.status === ProjectStatus.AwaitingUserInput) &&
			project.runId
		) {
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
		} catch {
			projects.clearOpening(project.slug)
			releaseNavigation()
			router.push("/?error=Unable%20to%20resume%20project")
		}
	}

	return (
		<LandingPanel
			projects={projects.rows}
			currentProjectSlug={currentProjectSlug}
			isStarting={isStarting}
			onProjectClick={handleProjectClick}
			onCreateRunSubmit={handleCreateRunSubmit}
			onCancelRun={handleCancelRun}
			onDeleteProject={handleDeleteProject}
		/>
	)
}
