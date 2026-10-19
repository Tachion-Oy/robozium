// Own the displayed run's subscription lifetime for the app, surviving view changes.
// Reducers own data and presentation; this hook owns requests, cancellation and stale callbacks.
// Launching a run belongs to projects/useProjectLaunch, which hands the new run to open.
import { useCallback, useEffect, useReducer, useRef } from "react"
import type { DesktopApiClient } from "../api/client"
import { watchRun } from "../run/run-updates"
import { reduceRunSession, type RunSession } from "./session-reducer"

export interface RunSessionState {
	session: RunSession | null
	open: (runId: string, project: string) => void
	select: (index: number) => void
	retry: () => void
}

/** App-owned session survives view changes; opening another run only disposes local work. */
export function useRunSession(client: DesktopApiClient | null): RunSessionState {
	const [session, dispatch] = useReducer(reduceRunSession, null)
	const dispose = useRef<(() => void) | null>(null)
	const generation = useRef(0)
	const stop = useCallback(() => {
		generation.current++
		dispose.current?.()
		dispose.current = null
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
		subscribe(runId, project)
	}
	return { session, open,
		select: (index: number) => dispatch({ type: "select", index }),
		retry: () => {
			if (!session) return
			dispatch({ type: "retry" })
			subscribe(session.run.runId, session.run.project)
		} }
}
