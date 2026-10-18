import { useEffect, useState } from "react"
import type { BackendMode } from "../../../src/bridge"
import type { DesktopApiClient } from "../api/client"
import { useModels, type ModelsState } from "../models/useModels"
import { useProjects, type ProjectsState } from "../projects/useProjects"
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
	enabled: boolean
	existing: boolean
	start: () => void
}

export interface RunWorkspace {
	run: RunSessionController
	projects: ProjectsState
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

/** Coordinate feature owners; requests, navigation and draft revisions stay in their own hooks. */
export function useRunWorkspace(
	client: DesktopApiClient | null,
	connected: boolean,
	mode: BackendMode | null,
): RunWorkspace {
	const recovery = useRecovery(mode)
	const run = useRunSession(client)
	const draft = useReplyDraft(recovery.initial.draft)
	const navigation = useRunNavigation(run.session, run.creating, recovery.initial.run?.id ?? null)
	const models = useModels(client, connected)
	const projects = useProjects(client, navigation.view === "projects", connected, {
		onDeleted: run.closeProject,
		onCancelled: finishCancellation,
		busyProjects: busyProjects(run),
		initialSelected: recovery.initial.selectedProject,
	})
	const [restored, setRestored] = useState(recovery.initial.run === null)
	const [hasPreview, setHasPreview] = useState(false)
	const actions = runActionAvailability(run, projects, connected)
	const launch = launchAvailability(projects, models, run.creating, connected)
	const canSend = actions.canReply && Boolean(draft.value.trim())

	function finishCancellation(project: string): void {
		if (navigation.finishCancellation(project)) run.refresh()
	}

	function cancelCurrentProject(): void {
		if (!client || !run.session || !actions.canCancel) return
		navigation.waitForCancellation()
		projects.cancelProject(run.session.run.project, actions.hasActiveRun)
	}

	async function send(): Promise<void> {
		if (canSend) await draft.submit(run.reply)
	}

	async function startSelectedProject(): Promise<void> {
		if (!client) {
			setHasPreview(true)
			navigation.showRun()
			return
		}

		if (launch.canOpen && launch.existingRunId) {
			navigation.showRun()
			if (run.session?.run.runId !== launch.existingRunId) {
				run.restore(launch.existingRunId, projects.selected)
				navigation.watchCompletion(launch.existingRunId)
			}
			return
		}

		if (!launch.canStart) return
		navigation.clearAutomaticReturn()
		const runId = await run.start(projects.selected)
		if (runId) {
			projects.refresh()
			navigation.showRun()
			navigation.watchCompletion(runId)
		}
	}

	// Restore once after readiness. The session validates the saved run before subscribing.
	const { restore } = run
	const { showRecoveredRun } = navigation
	useEffect(() => {
		if (!client || !connected || restored) return

		const saved = recovery.initial.run
		if (saved) {
			restore(saved.id, saved.project)
			showRecoveredRun(saved.id)
		}
		setRestored(true)
	}, [client, connected, restored, recovery.initial.run, restore, showRecoveredRun])

	const session = run.session
	const refreshProjects = projects.refresh
	useEffect(() => {
		if (session) refreshProjects()
	}, [session?.run.runId, session?.run.status, refreshProjects])

	useEffect(() => {
		if (!restored) return
		recovery.save({
			version: 1,
			selectedProject: projects.selected,
			draft: draft.value,
			run: session ? { id: session.run.runId, project: session.run.project } : null,
		})
	}, [restored, recovery.save, projects.selected, draft.value, session?.run.runId, session?.run.project])

	return {
		run,
		projects,
		models,
		draft,
		navigation,
		recoveryError: recovery.error,
		hasRun: client ? session !== null : hasPreview,
		launch: {
			enabled: !client || launch.canStart || launch.canOpen,
			existing: launch.existingRunId !== null,
			start: () => { void startSelectedProject() },
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
