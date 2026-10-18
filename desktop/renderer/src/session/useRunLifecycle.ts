import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import type { DesktopApiClient } from "../api/client"
import { withDeadline } from "../api/request"
import { createRun } from "../run/run-api"
import { watchRun, errorMessage, type RunWatcher } from "../run/run-updates"
import { reduceRunSession, type RunSession, type SessionAction } from "./session-reducer"

interface RunCreation {
	project: string
	controller: AbortController
}

export interface RunLifecycleState {
	session: RunSession | null
	creating: boolean
	creatingProject: string
	createError: string
	launchRun: (project: string) => Promise<string | null>
	restoreRun: (runId: string, project: string) => void
	/** Return whether this removed the displayed session. */
	closeProject: (project: string) => boolean
	retry: () => void
	refresh: () => void
	select: (index: number) => void
}

/** Internal collaboration contract for interactions bound to the displayed run. */
export interface RunLifecycle extends RunLifecycleState {
	scope: AbortSignal | null
	getSession: () => RunSession | null
	isCreating: () => boolean
	dispatch: (action: SessionAction) => void
}

/** Manage run identity, creation and subscriptions; disposal invalidates every interaction. */
export function useRunLifecycle(client: DesktopApiClient | null): RunLifecycle {
	const [session, dispatch] = useReducer(reduceRunSession, null)
	const [creatingProject, setCreatingProject] = useState("")
	const [createError, setCreateError] = useState("")
	const [scope, setScope] = useState<AbortSignal | null>(null)
	const creation = useRef<RunCreation | null>(null)
	const lifetime = useRef<AbortController | null>(null)
	const watcher = useRef<RunWatcher | null>(null)
	const latest = useRef(session)
	latest.current = session

	const stopSession = useCallback((): void => {
		lifetime.current?.abort()
		lifetime.current = null
		watcher.current?.dispose()
		watcher.current = null
		setScope(null)
	}, [])

	useEffect(() => () => {
		stopSession()
		creation.current?.controller.abort()
		creation.current = null
		setCreatingProject("")
	}, [client, stopSession])

	const subscribe = useCallback((runId: string, project: string, verifyBeforeStream = false): void => {
		if (!client) return
		stopSession()
		const controller = new AbortController()
		lifetime.current = controller
		setScope(controller.signal)
		watcher.current = watchRun(client, runId, project, action => {
			if (!controller.signal.aborted) dispatch(action)
		}, { verifyBeforeStream })
	}, [client, stopSession])

	const openRun = useCallback((runId: string, project: string, verifyBeforeStream = false): void => {
		dispatch({ type: "open", runId, project })
		subscribe(runId, project, verifyBeforeStream)
	}, [subscribe])

	const restoreRun = useCallback((runId: string, project: string): void => {
		openRun(runId, project, true)
	}, [openRun])

	async function launchRun(project: string): Promise<string | null> {
		if (!client || !project || creation.current) return null
		const request = { project, controller: new AbortController() }
		creation.current = request
		setCreatingProject(project)
		setCreateError("")
		try {
			const runId = await withDeadline(request.controller.signal, signal => createRun(client, project, signal))
			if (creation.current !== request || request.controller.signal.aborted) return null
			openRun(runId, project)
			return runId
		} catch (error) {
			if (creation.current === request) setCreateError(errorMessage(error))
			return null
		} finally {
			if (creation.current === request) {
				creation.current = null
				setCreatingProject("")
			}
		}
	}

	const closeProject = useCallback((slug: string): boolean => {
		if (creation.current?.project === slug) {
			creation.current.controller.abort()
			creation.current = null
			setCreatingProject("")
		}
		if (latest.current?.run.project !== slug) return false
		stopSession()
		dispatch({ type: "close" })
		return true
	}, [stopSession])

	function retry(): void {
		if (!session || creation.current) return
		// Preserve acknowledged prompts and pinned history when replacing the subscription.
		dispatch({ type: "retry" })
		subscribe(session.run.runId, session.run.project)
	}

	return {
		session,
		creating: Boolean(creatingProject),
		creatingProject,
		createError,
		launchRun,
		restoreRun,
		closeProject,
		retry,
		refresh: () => watcher.current?.refresh(),
		select: index => dispatch({ type: "select", index }),
		scope,
		getSession: () => latest.current,
		isCreating: () => creation.current !== null,
		dispatch,
	}
}
