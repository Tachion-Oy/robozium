// Own the displayed run's subscription lifetime for the app, surviving view changes.
// Reducers own data and presentation; this hook owns requests, cancellation and stale callbacks.
// Launching a run belongs to projects/useProjectMutations, which hands the new run to open;
// writes to the displayed run belong to useRunMutations, bound to this hook's scope.
import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import type { DesktopApiClient } from "../api/client"
import { showErrorToast, showNotificationToast } from "../feedback/notices"
import { RunEventType, RunStatus } from "../run/run-contracts"
import { watchRun } from "../run/run-updates"
import { reduceRunSession, type RunSession } from "./session-reducer"

export interface RunSessionState {
	session: RunSession | null
	/** Ends when the displayed run's subscription does: on open, retry, a new client or unmount. */
	scope: AbortSignal | null
	open: (runId: string, project: string) => void
	/** Record an acknowledged reply, so later snapshots cannot revive its prompt. */
	acknowledge: (promptId: string) => void
	select: (index: number) => void
	retry: () => void
}

/** App-owned session survives view changes; opening another run only disposes local work. */
export function useRunSession(client: DesktopApiClient): RunSessionState {
	const [session, dispatch] = useReducer(reduceRunSession, null)
	const dispose = useRef<(() => void) | null>(null)
	const lifetime = useRef<AbortController | null>(null)
	const [scope, setScope] = useState<AbortSignal | null>(null)
	const generation = useRef(0)
	const stop = useCallback(() => {
		generation.current++
		dispose.current?.()
		dispose.current = null
		lifetime.current?.abort()
		lifetime.current = null
		setScope(null)
	}, [])
	useEffect(() => stop, [client, stop])
	const subscribe = (runId: string, project: string) => {
		stop()
		const current = generation.current
		lifetime.current = new AbortController()
		setScope(lifetime.current.signal)
		dispose.current = watchRun(client, runId, project, action => {
			if (generation.current !== current) return
			dispatch(action)
			if (action.type === "snapshot" && action.view.status === RunStatus.Failed) {
				showErrorToast({ title: "Run failed", message: `Could not run "${project}".`, detail: action.view.error })
			}
			// Live frames only: snapshots replay history, which would repeat past notices.
			if (action.type === "frame" && action.frame.type === RunEventType.ImagesOmitted) {
				showNotificationToast({ title: "Images omitted", message: action.frame.message, detail: action.frame.model, tone: "info" })
			}
		})
	}
	const open = (runId: string, project: string) => {
		dispatch({ type: "open", runId, project })
		subscribe(runId, project)
	}
	return { session, scope, open,
		acknowledge: promptId => dispatch({ type: "replied", promptId }),
		select: (index: number) => dispatch({ type: "select", index }),
		retry: () => {
			if (!session) return
			dispatch({ type: "retry" })
			subscribe(session.run.runId, session.run.project)
		} }
}
