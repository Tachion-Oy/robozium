import type { DesktopApiClient } from "../api/client"
import { useRunLifecycle, type RunLifecycleState } from "./useRunLifecycle"
import { useRunInteractions, type RunInteractions } from "./useRunInteractions"

export interface RunSessionController extends RunLifecycleState, RunInteractions {}

/** Expose the displayed run while keeping lifecycle and interaction ownership separate. */
export function useRunSession(client: DesktopApiClient | null): RunSessionController {
	const lifecycle = useRunLifecycle(client)
	const interactions = useRunInteractions(client, lifecycle)

	return {
		session: lifecycle.session,
		creating: lifecycle.creating,
		creatingProject: lifecycle.creatingProject,
		createError: lifecycle.createError,
		launchRun: lifecycle.launchRun,
		restoreRun: lifecycle.restoreRun,
		closeProject: lifecycle.closeProject,
		retry: lifecycle.retry,
		refresh: lifecycle.refresh,
		select: lifecycle.select,
		...interactions,
	}
}
