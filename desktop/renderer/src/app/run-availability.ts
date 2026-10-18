import type { ModelsState } from "../models/useModels"
import type { ProjectManagement } from "../projects/useProjectManagement"
import type { ProjectCancellation } from "../projects/useProjectCancellation"
import { isTerminal } from "../run/run-contracts"
import type { RunSessionController } from "../session/useRunSession"

export interface RunActionAvailability {
	cancelling: boolean
	hasActiveRun: boolean
	canReply: boolean
	canInterrupt: boolean
	canCancel: boolean
}

export interface LaunchAvailability {
	existingRunId: string | null
	canOpen: boolean
	canLaunch: boolean
}

export interface LaunchContext {
	management: ProjectManagement
	cancellation: ProjectCancellation
	selectedProject: string
	models: ModelsState
	creating: boolean
	connected: boolean
}

/** Projects with local work cannot be deleted, even after selection changes. */
export function busyProjects(run: RunSessionController): string[] {
	const projects: string[] = []
	if (run.creatingProject) projects.push(run.creatingProject)
	const session = run.session
	if (!session) return projects

	const active = !session.run.unavailable && !isTerminal(session.run.status)
	if (active || run.replying || run.interrupting) {
		projects.push(session.run.project)
	}
	return projects
}

export function runActionAvailability(
	run: RunSessionController,
	management: ProjectManagement,
	cancellation: ProjectCancellation,
	connected: boolean,
): RunActionAvailability {
	const session = run.session
	const project = session?.run.project
	const cancelling = project !== undefined && cancellation.isCancelling(project)
	const deleting = project !== undefined && management.isDeleting(project)
	const available = connected && !deleting && !cancelling
	const hasActiveRun = Boolean(session && !session.run.unavailable
		&& !isTerminal(session.run.status) && session.run.status !== "cancelling")
	const backgroundWork = management.projects.some(row => row.slug === project && row.status === "syncing")

	return {
		cancelling,
		hasActiveRun,
		canReply: available && run.canReply,
		canInterrupt: available && run.canInterrupt,
		canCancel: available && !run.creating && (hasActiveRun || backgroundWork),
	}
}

export function launchAvailability({
	management,
	cancellation,
	selectedProject,
	models,
	creating,
	connected,
}: LaunchContext): LaunchAvailability {
	const selected = management.projects.find(project => project.slug === selectedProject)
	let existingRunId: string | null = null
	if (selected?.status === "running" || selected?.status === "awaiting_user_input") {
		existingRunId = selected.runId
	}

	const projectBusy = cancellation.isCancelling(selectedProject) || management.isDeleting(selectedProject)
	const available = connected && !creating && !management.loadError && !projectBusy
	const dormant = selected?.status === "dormant" && selected.runId === null
	const modelConfirmed = Boolean(models.selection?.selected_model_id) && !models.pending && !models.error

	return {
		existingRunId,
		canOpen: available && existingRunId !== null,
		canLaunch: available && dormant && modelConfirmed,
	}
}
