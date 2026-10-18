import { useEffect, useState } from "react"
import type { BackendMode } from "../../../src/bridge"
import type { DesktopApiClient } from "../api/client"
import { useModels, type ModelsState } from "../models/useModels"
import { useProjectManagement, type ProjectManagement, type ProjectRemoval } from "../projects/useProjectManagement"
import { useProjectCancellation } from "../projects/useProjectCancellation"
import { canCancelProject, type Project } from "../projects/projects-api"
import { useRecovery } from "../recovery/useRecovery"
import { useRunSession, type RunSessionController } from "../session/useRunSession"
import { busyProjects, launchAvailability, runActionAvailability } from "./run-availability"
import { useReplyDraft, type ReplyDraft } from "./useReplyDraft"
import { useRunNavigation, type RunNavigation } from "./useRunNavigation"

export interface RunAction {
	enabled: boolean
	pending: boolean
	onClick: () => void
}

export interface RunLaunch {
	canLaunch: boolean
	canOpen: boolean
	existing: boolean
	launchRun: () => void
	openRun: () => void
}

export interface ProjectWork {
	selectedProject: string
	selectProject: (slug: string) => void
	cancelling: ReadonlySet<string>
	error: string
	canCancelWork: (slug: string) => boolean
	cancelWork: (slug: string) => void
}

export interface ProjectWorkspace {
	run: RunSessionController
	management: ProjectManagement
	work: ProjectWork
	models: ModelsState
	draft: ReplyDraft
	navigation: RunNavigation
	recoveryError: string
	hasRun: boolean
	launch: RunLaunch
	reply: RunAction
	interrupt: RunAction
	cancel: RunAction
}

const PROJECT_POLL_INTERVAL = 3000
const CANCELLATION_POLL_INTERVAL = 250

/** Coordinate feature owners; requests, navigation and draft revisions stay in their own hooks. */
export function useProjectWorkspace(
	client: DesktopApiClient | null,
	connected: boolean,
	mode: BackendMode | null,
): ProjectWorkspace {
	const recovery = useRecovery(mode)
	const run = useRunSession(client)
	const draft = useReplyDraft(recovery.initial.draft)
	const navigation = useRunNavigation(run.session, run.creating, recovery.initial.run?.id ?? null)
	const models = useModels(client, connected)
	const cancellation = useProjectCancellation(client)
	const [selectedProject, selectProject] = useState(recovery.initial.selectedProject)
	const management = useProjectManagement(client, navigation.view === "projects", connected, {
		onCreated: selectProject,
		onDeleted: projectDeleted,
		onListed: projectsListed,
		hasLocalWork: slug => busyProjects(run).includes(slug) || cancellation.isCancelling(slug),
		pollInBackground: cancellation.pending.size > 0,
		pollInterval: cancellation.pending.size > 0 ? CANCELLATION_POLL_INTERVAL : PROJECT_POLL_INTERVAL,
	})
	const [restored, setRestored] = useState(recovery.initial.run === null)
	const [hasPreview, setHasPreview] = useState(false)
	const actions = runActionAvailability(run, management, cancellation, connected)
	const launchContext = { management, cancellation, selectedProject, models, creating: run.creating, connected }
	const launch = launchAvailability(launchContext)
	const canSend = actions.canReply && Boolean(draft.value.trim())

	function projectDeleted(removal: ProjectRemoval): void {
		selectProject(current => current === removal.slug ? "" : current)
		const sessionClosed = run.closeProject(removal.slug)
		if (sessionClosed) navigation.sessionRemoved(removal.focus)
	}

	function projectsListed(projects: Project[]): void {
		selectProject(current => projects.some(project => project.slug === current) ? current : "")
		for (const slug of cancellation.reconcile(projects)) {
			if (navigation.finishCancellation(slug)) run.refresh()
		}
	}

	function canCancelWork(slug: string): boolean {
		if (!client || !connected || management.isDeleting(slug) || cancellation.isCancelling(slug)) return false
		const project = management.projects.find(row => row.slug === slug)
		return Boolean(project && canCancelProject(project))
	}

	async function cancelWork(slug: string, hasActiveRun = false): Promise<void> {
		if (!client || !connected || management.isDeleting(slug) || cancellation.isCancelling(slug)) return
		if (!hasActiveRun && !canCancelWork(slug)) return
		const result = await cancellation.cancelWork(slug)
		if (result !== "ignored") management.refresh()
	}

	function cancelCurrentProject(): void {
		if (!client || !run.session || !actions.canCancel) return
		navigation.waitForCancellation()
		void cancelWork(run.session.run.project, actions.hasActiveRun)
	}

	async function send(): Promise<void> {
		if (canSend) await draft.submit(run.reply)
	}

	function openRun(): void {
		const current = launchAvailability(launchContext)
		if (!current.canOpen || !current.existingRunId) return
		navigation.showRun()
		if (run.session?.run.runId !== current.existingRunId) {
			run.restoreRun(current.existingRunId, selectedProject)
			navigation.watchCompletion(current.existingRunId)
		}
	}

	async function launchRun(): Promise<void> {
		if (!client) {
			setHasPreview(true)
			navigation.showRun()
			return
		}

		if (!launchAvailability(launchContext).canLaunch) return
		const intent = navigation.beginLaunch()
		const runId = await run.launchRun(selectedProject)
		if (runId) {
			management.refresh()
			navigation.finishLaunch(intent, runId)
		}
	}

	// Restore once after readiness. The session validates the saved run before subscribing.
	const { restoreRun } = run
	const { showRecoveredRun } = navigation
	useEffect(() => {
		if (!client || !connected || restored) return

		const saved = recovery.initial.run
		if (saved) {
			restoreRun(saved.id, saved.project)
			showRecoveredRun(saved.id)
		}
		setRestored(true)
	}, [client, connected, restored, recovery.initial.run, restoreRun, showRecoveredRun])

	const session = run.session
	const refreshProjects = management.refresh
	useEffect(() => {
		if (session) refreshProjects()
	}, [session?.run.runId, session?.run.status, refreshProjects])

	useEffect(() => {
		if (!restored) return
		recovery.save({
			version: 1,
			selectedProject,
			draft: draft.value,
			run: session ? { id: session.run.runId, project: session.run.project } : null,
		})
	}, [restored, recovery.save, selectedProject, draft.value, session?.run.runId, session?.run.project])

	return {
		run,
		management,
		work: {
			selectedProject,
			selectProject,
			cancelling: cancellation.pending,
			error: cancellation.error,
			canCancelWork,
			cancelWork: slug => { void cancelWork(slug) },
		},
		models,
		draft,
		navigation,
		recoveryError: recovery.error,
		hasRun: client ? session !== null : hasPreview,
		launch: {
			canLaunch: !client || launch.canLaunch,
			canOpen: launch.canOpen,
			existing: launch.existingRunId !== null,
			launchRun: () => { void launchRun() },
			openRun,
		},
		reply: {
			enabled: canSend,
			pending: run.replying,
			onClick: () => { void send() },
		},
		interrupt: {
			enabled: actions.canInterrupt,
			pending: run.interrupting,
			onClick: () => { void run.interrupt() },
		},
		cancel: {
			enabled: Boolean(client) && actions.canCancel,
			pending: actions.cancelling,
			onClick: cancelCurrentProject,
		},
	}
}
