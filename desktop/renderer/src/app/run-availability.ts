import type { ModelsState } from "../models/useModels"
import type { ProjectsState } from "../projects/useProjects"
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
	canStart: boolean
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
	projects: ProjectsState,
	connected: boolean,
): RunActionAvailability {
	const session = run.session
	const project = session?.run.project
	const cancelling = project !== undefined && projects.cancelling.has(project)
	const deleting = project !== undefined && projects.deleting.has(project)
	const available = connected && !deleting && !cancelling
	const hasActiveRun = Boolean(session && !session.run.unavailable
		&& !isTerminal(session.run.status) && session.run.status !== "cancelling")
	const backgroundWork = projects.projects.some(row => row.slug === project && row.status === "syncing")

	return {
		cancelling,
		hasActiveRun,
		canReply: available && run.canReply,
		canInterrupt: available && run.canInterrupt,
		canCancel: available && !run.creating && (hasActiveRun || backgroundWork),
	}
}

export function launchAvailability(
	projects: ProjectsState,
	models: ModelsState,
	creating: boolean,
	connected: boolean,
): LaunchAvailability {
	const selected = projects.projects.find(project => project.slug === projects.selected)
	let existingRunId: string | null = null
	if (selected?.status === "running" || selected?.status === "awaiting_user_input") {
		existingRunId = selected.runId
	}

	const projectBusy = projects.cancelling.has(projects.selected) || projects.deleting.has(projects.selected)
	const available = connected && !creating && !projects.loadError && !projectBusy
	const dormant = selected?.status === "dormant" && selected.runId === null
	const modelConfirmed = Boolean(models.selection?.selected_model_id) && !models.pending && !models.error

	return {
		existingRunId,
		canOpen: available && existingRunId !== null,
		canStart: available && dormant && modelConfirmed,
	}
}
