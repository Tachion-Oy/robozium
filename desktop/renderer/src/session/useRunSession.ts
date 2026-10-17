// Own run creation and subscription lifetimes for the app, surviving view changes.
// Reducers own data and presentation; this hook owns requests, cancellation and stale callbacks.
import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import type { DesktopApiClient } from "../api/client"
import { createRun } from "../run/run-api"
import { withDeadline } from "../api/request"
import { watchRun, errorMessage } from "../run/run-updates"
import { reduceRunSession } from "./session-reducer"

/** App-owned session survives view changes; opening another run only disposes local work. */
export function useRunSession(client: DesktopApiClient | null) {
	const [session, dispatch] = useReducer(reduceRunSession, null)
	const [creating, setCreating] = useState(false)
	const [createError, setCreateError] = useState("")
	const creation = useRef<AbortController | null>(null)
	const dispose = useRef<(() => void) | null>(null)
	const generation = useRef(0)
	const stop = useCallback(() => {
		generation.current++
		dispose.current?.()
		dispose.current = null
		creation.current?.abort()
		creation.current = null
	}, [])
	useEffect(() => stop, [client, stop])
	const subscribe = (runId: string, project: string) => {
		if (!client) return
		stop()
		const current = generation.current
		dispose.current = watchRun(client, runId, project, action => {
			if (generation.current === current) dispatch(action)
		})
	}
	const open = (runId: string, project: string) => {
		if (!client) return
		dispatch({ type: "open", runId, project })
		setCreating(false)
		subscribe(runId, project)
	}
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
	return { session, creating, createError, start, open,
		select: (index: number) => dispatch({ type: "select", index }),
		retry: () => {
			if (!session || creation.current) return
			dispatch({ type: "retry" })
			subscribe(session.run.runId, session.run.project)
		} }
}
