import { fetchRunView, AgentApiError } from "../client"
import { swarn } from "../log"
import type { SessionEvent } from "./reducer"

type Dispatch = (event: SessionEvent) => void

export function startRunSessionPoller(runId: string, dispatch: Dispatch) {
	// Per-poller lifecycle flag in this closure.
	let active = true

	const pollRunView = async () => {
		if (!active) return
		try {
			const runView = await fetchRunView(runId)
			if (!active) return
			dispatch({ class: "runView", type: "received", runView, source: "poll" })
		} catch (error) {
			if (!active) return
			if (error instanceof AgentApiError && error.status === 404) {
				// A missing run is permanent. Publish the same durable transport
				// failure used by the stream so the session stops both transports
				// and the route returns home instead of warning every two seconds.
				dispatch({
					class: "stream",
					type: "open_failed",
					message: error.message,
				})
				return
			}
			swarn("hud", `run view poll failed runId=${runId}`, error)
		}
	}

	void pollRunView()
	const intervalId = window.setInterval(() => {
		void pollRunView()
	}, 2000)

	return () => {
		// One-way teardown for this poller instance.
		active = false
		window.clearInterval(intervalId)
	}
}
