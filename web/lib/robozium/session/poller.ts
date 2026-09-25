import { fetchRunView, AgentApiError } from "../client"
import { swarn } from "../log"
import type { SessionEvent } from "./reducer"

type Dispatch = (event: SessionEvent) => void

export function startRunSessionPoller(runId: string, dispatch: Dispatch) {
	let active = true
	let timeoutId: number | null = null
	const controller = new AbortController()

	// Schedule only after a request settles, so an older snapshot cannot arrive
	// after a newer poll and restore stale status or prompts.
	const pollRunView = async () => {
		if (!active) return
		try {
			const runView = await fetchRunView(runId, { signal: controller.signal })
			if (!active) return
			dispatch({ class: "runView", type: "received", runView, source: "poll" })
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
