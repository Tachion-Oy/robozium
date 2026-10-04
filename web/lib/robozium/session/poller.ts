import { AgentApiError } from "../client"
import { swarn } from "../log"
import type { SessionEvent } from "./reducer"
import type { RunViewLoader } from "./snapshot"

type Dispatch = (event: SessionEvent) => void

export function startRunSessionPoller(
	runId: string,
	dispatch: Dispatch,
	loadRunView: RunViewLoader,
) {
	let active = true
	let timeoutId: number | null = null
	const controller = new AbortController()

	// Schedule only after the shared loader settles, avoiding a backlog of polls.
	const pollRunView = async () => {
		if (!active) return
		try {
			await loadRunView(controller.signal)
		} catch (error) {
			if (!active) return
			if (error instanceof AgentApiError && error.status === 404) {
				dispatch({
					class: "stream",
					type: "open_failed",
					message: error.message,
				})
				return
			}
			swarn("hud", `run view poll failed runId=${runId}`, error)
		} finally {
			if (active) timeoutId = window.setTimeout(() => void pollRunView(), 2000)
		}
	}

	void pollRunView()
	return () => {
		active = false
		controller.abort()
		if (timeoutId !== null) window.clearTimeout(timeoutId)
	}
}
