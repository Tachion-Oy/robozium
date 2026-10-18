import { useCallback, useEffect, useRef, useState } from "react"
import { isTerminal } from "../run/run-contracts"
import type { RunSession } from "../session/session-reducer"
import type { AppView } from "./navigation"

/** Own automatic return to overview, explicit history viewing and navigation focus. */
export function useRunNavigation(session: RunSession | null, creating: boolean, savedRunId: string | null) {
	const [view, setView] = useState<AppView>("projects")
	const [focusRunEditor, setFocusRunEditor] = useState(false)
	const [overviewFocus, setOverviewFocus] = useState<string | null>(null)
	const [returnOnCompletion, setReturnOnCompletion] = useState<string | null>(null)
	const returnAfterCancel = useRef<string | null>(null)
	const recoveringRun = useRef(savedRunId)

	const clearAutomaticReturn = useCallback(() => {
		returnAfterCancel.current = null
		setReturnOnCompletion(null)
	}, [])

	function navigate(next: AppView) {
		clearAutomaticReturn()
		if (next === "run" && session && !isTerminal(session.run.status)) {
			setReturnOnCompletion(session.run.runId)
		}
		setOverviewFocus(null)
		setFocusRunEditor(false)
		setView(next)
	}

	function showRun() {
		navigate("run")
		setFocusRunEditor(true)
	}

	const showRecoveredRun = useCallback((runId: string) => {
		setView("run")
		setReturnOnCompletion(runId)
	}, [])

	const returnToOverview = useCallback((project: string) => {
		clearAutomaticReturn()
		setFocusRunEditor(false)
		setOverviewFocus(project)
		setView(current => current === "run" ? "projects" : current)
	}, [clearAutomaticReturn])

	function waitForCancellation() {
		returnAfterCancel.current = session?.run.runId ?? null
	}

	function finishCancellation(project: string): boolean {
		if (!session || session.run.project !== project) return false
		if (session.run.runId !== returnAfterCancel.current) return false

		returnToOverview(project)
		return true
	}

	const run = session?.run
	useEffect(() => {
		if (!run?.synchronized) return

		if (recoveringRun.current === run.runId) {
			recoveringRun.current = null
			// Reopening an already finished run is an explicit history view.
			if (isTerminal(run.status)) {
				setReturnOnCompletion(null)
				return
			}
		}

		const shouldReturn = run.runId === returnOnCompletion && isTerminal(run.status)
		if (shouldReturn && !creating) returnToOverview(run.project)
	}, [run?.runId, run?.status, run?.synchronized, returnOnCompletion, creating, returnToOverview])

	return {
		view,
		focusRunEditor,
		overviewFocus,
		navigate,
		showRun,
		showRecoveredRun,
		clearAutomaticReturn,
		watchCompletion: setReturnOnCompletion,
		waitForCancellation,
		finishCancellation,
	}
}
