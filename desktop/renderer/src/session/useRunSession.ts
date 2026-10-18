// Own run creation, writes and subscription lifetimes for the app, surviving view changes.
// Reducers own data and presentation; this hook owns requests and obsolete-result guards.
import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import type { DesktopApiClient } from "../api/client"
import { withDeadline } from "../api/request"
import { createRun, submitReply, interruptRun } from "../run/run-api"
import { RunStatus } from "../run/run-contracts"
import { watchRun, errorMessage, type RunWatcher } from "../run/run-updates"
import { reduceRunSession } from "./session-reducer"

/** One displayed session; a replacement creation has its own lifetime until accepted. */
export function useRunSession(client: DesktopApiClient | null) {
	const [session, dispatch] = useReducer(reduceRunSession, null)
	const [creatingProject, setCreatingProject] = useState("")
	const [createError, setCreateError] = useState("")
	const creation = useRef<{ project: string; controller: AbortController } | null>(null)
	const watcher = useRef<RunWatcher | null>(null)
	const generation = useRef(0)
	const interruptRequest = useRef<AbortController | null>(null)
	const [interrupting, setInterrupting] = useState(false)
	const replyRequest = useRef<AbortController | null>(null)
	const [replying, setReplying] = useState(false)
	const [actionError, setActionError] = useState("")
	const latest = useRef(session)
	latest.current = session

	const stopSession = useCallback(() => {
		generation.current++
		interruptRequest.current?.abort()
		interruptRequest.current = null
		replyRequest.current?.abort()
		replyRequest.current = null
		watcher.current?.dispose()
		watcher.current = null
		setInterrupting(false)
		setReplying(false)
		setActionError("")
	}, [])
	useEffect(() => () => {
		stopSession()
		creation.current?.controller.abort()
		creation.current = null
		setCreatingProject("")
	}, [client, stopSession])

	const subscribe = useCallback((runId: string, project: string, verifyBeforeStream = false) => {
		if (!client) return
		stopSession()
		const current = generation.current
		watcher.current = watchRun(client, runId, project, action => {
			if (generation.current === current) dispatch(action)
		}, { verifyBeforeStream })
	}, [client, stopSession])
	const open = useCallback((runId: string, project: string, verifyBeforeStream = false) => {
		dispatch({ type: "open", runId, project })
		subscribe(runId, project, verifyBeforeStream)
	}, [subscribe])
	const restore = useCallback((runId: string, project: string) => open(runId, project, true), [open])

	const start = async (project: string): Promise<boolean> => {
		if (!client || !project || creation.current) return false
		const request = { project, controller: new AbortController() }
		creation.current = request
		setCreatingProject(project)
		setCreateError("")
		try {
			const runId = await withDeadline(request.controller.signal, signal => createRun(client, project, signal))
			if (creation.current !== request || request.controller.signal.aborted) return false
			open(runId, project)
			return true
		} catch (error) {
			if (creation.current === request) setCreateError(errorMessage(error))
			return false
		} finally {
			if (creation.current === request) {
				creation.current = null
				setCreatingProject("")
			}
		}
	}

	const canReply = Boolean(session?.run.synchronized && session.run.status === RunStatus.AwaitingUserInput
		&& session.run.prompt && !session.run.error)
		&& !creatingProject && !replying
	const reply = async (content: string): Promise<boolean> => {
		const promptId = session?.run.prompt?.id
		if (!client || !session || !canReply || !promptId || !content.trim() || replyRequest.current || creation.current) return false
		const controller = new AbortController()
		const current = generation.current
		replyRequest.current = controller
		setReplying(true)
		setActionError("")
		try {
			await withDeadline(controller.signal, signal => submitReply(client, session.run.runId, promptId, content, signal))
			if (generation.current !== current || controller.signal.aborted) return false
			dispatch({ type: "replied", promptId })
			return latest.current?.run.prompt?.id === promptId
		} catch (error) {
			if (generation.current === current) {
				setActionError(errorMessage(error))
				dispatch({ type: "retry" })
			}
			return false
		} finally {
			if (generation.current === current) {
				replyRequest.current = null
				setReplying(false)
				watcher.current?.refresh()
			}
		}
	}

	useEffect(() => {
		if (session?.run.synchronized && (session.run.prompt || session.run.status !== RunStatus.Running)) setInterrupting(false)
	}, [session?.run.synchronized, session?.run.prompt, session?.run.status])
	const canInterrupt = Boolean(session?.run.synchronized && session.run.status === RunStatus.Running && !session.run.prompt)
		&& !creatingProject && !interrupting
	const interrupt = async () => {
		if (!client || !session || !canInterrupt || interruptRequest.current || creation.current) return
		const controller = new AbortController()
		interruptRequest.current = controller
		setInterrupting(true)
		setActionError("")
		try {
			const accepted = await withDeadline(controller.signal, signal => interruptRun(client, session.run.runId, signal))
			if (!controller.signal.aborted && !accepted) {
				setInterrupting(false)
				setActionError("Interruption was not accepted. Refreshing run status.")
			}
		} catch (error) {
			if (!controller.signal.aborted) {
				setInterrupting(false)
				setActionError(errorMessage(error))
			}
		} finally {
			if (interruptRequest.current === controller) {
				interruptRequest.current = null
				watcher.current?.refresh()
			}
		}
	}

	const closeProject = useCallback((slug: string) => {
		if (creation.current?.project === slug) {
			creation.current.controller.abort()
			creation.current = null
			setCreatingProject("")
		}
		if (latest.current?.run.project !== slug) return
		stopSession()
		dispatch({ type: "close" })
	}, [stopSession])
	const retry = () => {
		if (!session || creation.current) return
		// Keep run/HUD state, including acknowledged prompts and pinned history.
		dispatch({ type: "retry" })
		subscribe(session.run.runId, session.run.project)
	}
	return {
		session, start, restore, closeProject, creating: Boolean(creatingProject), creatingProject, createError,
		reply, replying, canReply, interrupt, interrupting, canInterrupt, actionError,
		retry, refresh: () => watcher.current?.refresh(),
		select: (index: number) => dispatch({ type: "select", index }),
	}
}
