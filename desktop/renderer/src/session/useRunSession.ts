// Own run creation and subscription lifetimes for the app, surviving view changes.
// Reducers own data and presentation; this hook owns requests, cancellation and stale callbacks.
import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import type { DesktopApiClient } from "../api/client"
import { createRun, submitReply, interruptRun } from "../run/run-api"
import { withDeadline } from "../api/request"
import { watchRun, errorMessage } from "../run/run-updates"
import { reduceRunSession } from "./session-reducer"

/** App-owned session survives view changes; opening another run only disposes local work. */
export function useRunSession(client: DesktopApiClient | null) {
	const [session, dispatch] = useReducer(reduceRunSession, null)
	const [creating, setCreating] = useState(false)
	const [createError, setCreateError] = useState("")
	const creation = useRef<AbortController | null>(null)
	const dispose = useRef<ReturnType<typeof watchRun> | null>(null)
	const generation = useRef(0)
	const interruptRequest = useRef<AbortController | null>(null)
	const [interrupting, setInterrupting] = useState(false)
	const replyRequest = useRef<AbortController | null>(null)
	const [replying, setReplying] = useState(false)
	const [actionError, setActionError] = useState("")
	const latest = useRef(session)
	latest.current = session
	const stop = useCallback(() => {
		generation.current++
		interruptRequest.current?.abort()
		interruptRequest.current = null
		setInterrupting(false)
		replyRequest.current?.abort()
		replyRequest.current = null
		setReplying(false)
		setActionError("")
		dispose.current?.()
		dispose.current = null
		creation.current?.abort()
		creation.current = null
	}, [])
	useEffect(() => stop, [client, stop])
	const subscribe = useCallback((runId: string, project: string, recover = false) => {
		if (!client) return
		stop()
		const current = generation.current
		dispose.current = watchRun(client, runId, project, action => {
			if (generation.current === current) dispatch(action)
		}, recover)
	}, [client, stop])
	const open = useCallback((runId: string, project: string, recover = false) => {
		if (!client) return
		dispatch({ type: "open", runId, project })
		setCreating(false)
		subscribe(runId, project, recover)
	}, [client, subscribe])
	const start = async (project: string): Promise<boolean> => {
		if (!client || !project || creation.current) return false
		const controller = new AbortController()
		creation.current = controller
		setCreating(true)
		setCreateError("")
		try {
			const runId = await withDeadline(controller.signal, signal => createRun(client, project, signal))
			if (creation.current !== controller || controller.signal.aborted) return false
			open(runId, project)
			return true
		} catch (error) {
			if (creation.current === controller) setCreateError(errorMessage(error))
			return false
		} finally {
			if (creation.current === controller) { creation.current = null; setCreating(false) }
		}
	}
	const reply = async (content: string): Promise<boolean> => {
		const promptId = session?.run.prompt?.id
		if (!client || !session?.run.synchronized || !promptId || !content.trim() || replyRequest.current || creation.current) return false
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
				dispose.current?.refresh()
			}
		}
	}
	useEffect(() => {
		if (session?.run.synchronized && (session.run.prompt || session.run.status !== "running")) setInterrupting(false)
	}, [session])
	const interrupt = async () => {
		if (!client || !session?.run.synchronized || session.run.status !== "running" || session.run.prompt || interruptRequest.current || interrupting || creation.current) return
		const controller = new AbortController()
		interruptRequest.current = controller
		setInterrupting(true)
		setActionError("")
		try {
			const accepted = await withDeadline(controller.signal, signal => interruptRun(client, session.run.runId, signal))
			if (!controller.signal.aborted && !accepted) { setInterrupting(false); setActionError("Interruption was not accepted. Refreshing run status.") }
		} catch (error) {
			if (!controller.signal.aborted) { setInterrupting(false); setActionError(errorMessage(error)) }
		} finally {
			if (interruptRequest.current === controller) {
				interruptRequest.current = null
				dispose.current?.refresh()
			}
		}
	}
	const closeProject = useCallback((slug: string) => {
		if (latest.current?.run.project !== slug) return
		stop()
		dispatch({ type: "close" })
	}, [stop])
	return { session, closeProject, interrupt, interrupting, refresh: () => dispose.current?.refresh(), creating, createError, start, open, reply, replying, actionError,
		select: (index: number) => dispatch({ type: "select", index }),
		retry: () => {
			if (!session || creation.current) return
			dispatch({ type: "retry" })
			subscribe(session.run.runId, session.run.project)
		} }
}
