import { useEffect, useState } from "react"
import type { BackendStatus } from "../../../../src/bridge"
import type { DesktopApiClient } from "../../api/client"

/** Own HTTP polling, its request deadline, and cancellation for each attempt. */
export function useBackendReadiness(client: DesktopApiClient | null) {
	const [status, setStatus] = useState<BackendStatus>({ state: "starting", message: "Connecting to the backend…" })
	const [attempt, setAttempt] = useState(0)

	useEffect(() => {
		if (!client) return
		let active = true
		let pollTimer: ReturnType<typeof setTimeout> | undefined
		let requestController: AbortController | undefined

		const checkReady = async () => {
			const controller = new AbortController()
			requestController = controller
			const deadline = setTimeout(() => controller.abort(), 3000)
			try {
				const ready = await client.request("/ready", { signal: controller.signal })
				if (!ready || typeof ready !== "object" || !("status" in ready) || ready.status !== "ready") {
					throw new Error("Backend is not ready.")
				}
				if (active) {
					setStatus({ state: "ready", message: "Connected" })
					// Schedule only after success, so requests never overlap and failure stops polling.
					pollTimer = setTimeout(checkReady, 5000)
				}
			} catch {
				if (active) setStatus({ state: "error", message: "Backend connection unavailable. Check the backend and retry." })
			} finally {
				clearTimeout(deadline)
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
