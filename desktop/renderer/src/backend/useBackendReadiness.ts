import { useEffect, useState } from "react"
import type { BackendStatus } from "../../../src/bridge"
import { ApiError, type DesktopApiClient } from "../api/client"
import { isRetryableReadError, RECONNECT_BASE_DELAY_MS, RECONNECT_MAX_DELAY_MS } from "../api/retry"
import { withDeadline } from "../api/request"

const READINESS_TIMEOUT_MS = 3000

/** Own HTTP polling, its request deadline, and cancellation for each attempt. */
export function useBackendReadiness(client: DesktopApiClient | null) {
	const [status, setStatus] = useState<BackendStatus>({ state: "starting", message: "Connecting to the backend…" })
	const [attempt, setAttempt] = useState(0)

	useEffect(() => {
		if (!client) return
		let active = true
		let retryDelay = RECONNECT_BASE_DELAY_MS
		let pollTimer: ReturnType<typeof setTimeout> | undefined
		let requestController: AbortController | undefined

		const checkReady = async () => {
			const controller = new AbortController()
			requestController = controller
			try {
				const ready = await withDeadline(controller.signal, signal => client.request("/ready", { signal }), READINESS_TIMEOUT_MS)
				if (!ready || typeof ready !== "object" || !("status" in ready) || ready.status !== "ready") {
					throw new ApiError("malformed", "Backend returned invalid readiness information.")
				}
				if (active) {
					setStatus({ state: "ready", message: "Connected" })
					// Schedule after settlement so health checks never overlap.
					retryDelay = RECONNECT_BASE_DELAY_MS
					pollTimer = setTimeout(checkReady, 5000)
				}
			} catch (error) {
				if (active) {
					const retry = isRetryableReadError(error)
					setStatus({ state: "error", message: retry ? "Backend connection unavailable. Reconnecting automatically; Retry checks now." : "Backend connection unavailable. Check the backend and retry." })
					if (retry) {
						pollTimer = setTimeout(checkReady, retryDelay)
						retryDelay = Math.min(retryDelay * 2, RECONNECT_MAX_DELAY_MS)
					}
				}
			} finally {
				requestController = undefined
			}
		}
		void checkReady()
		return () => {
			active = false
			clearTimeout(pollTimer)
			requestController?.abort()
		}
	}, [client, attempt])

	const retryConnection = () => {
		setStatus({ state: "starting", message: "Reconnecting…" })
		setAttempt(value => value + 1)
	}
	return { status, retryConnection }
}
