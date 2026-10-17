import { useEffect, useRef, useState } from "react"
import { DesktopApiClient } from "../../api/client"

type StartupState =
	| { state: "starting" | "error"; message: string }
	| { state: "ready"; client: DesktopApiClient | null }

/** Own Docker startup polling and discover the renderer's connection once ready. */
export function useBackendStartup() {
	const [startup, setStartup] = useState<StartupState>({ state: "starting", message: "Starting Robozium…" })
	const [attempt, setAttempt] = useState(0)
	// Keep this milestone through retries: a renderer connection failure must
	// never cause Docker startup to run again, even if connection discovery fails.
	const hasStartedBackend = useRef(false)

	useEffect(() => {
		let active = true
		let startupTimer: ReturnType<typeof setTimeout> | undefined

		const checkStartup = async () => {
			try {
				if (!hasStartedBackend.current) {
					const status = await window.robozium.getBackendStatus()
					if (!active) return
					if (status.state !== "ready") {
						setStartup({ state: status.state, message: status.message })
						if (status.state === "starting") startupTimer = setTimeout(checkStartup, 500)
						return
					}
					hasStartedBackend.current = true
				}
				const connection = await window.robozium.getBackendConnection()
				if (!active) return
				const client = connection === null ? null : new DesktopApiClient(connection.baseUrl)
				setStartup({ state: "ready", client })
			} catch {
				if (active) setStartup({ state: "error", message: "Could not read backend connection information. Restart Robozium." })
			}
		}

		const start = async () => {
			try {
				if (attempt > 0 && !hasStartedBackend.current) await window.robozium.retryBackend()
			} catch {
				if (active) setStartup({ state: "error", message: "Could not retry backend startup. Restart Robozium." })
				return
			}
			if (active) await checkStartup()
		}
		void start()
		return () => {
			active = false // IPC cannot be aborted; ignore any late result.
			clearTimeout(startupTimer)
		}
	}, [attempt])

	const retryStartup = () => {
		setStartup({ state: "starting", message: "Reconnecting…" })
		setAttempt(value => value + 1)
	}
	return { startup, retryStartup }
}
