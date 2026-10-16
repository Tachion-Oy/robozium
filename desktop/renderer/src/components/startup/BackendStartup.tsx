import { useEffect, useRef, useState, type ReactNode } from "react"
import type { BackendStatus } from "../../../../src/bridge"
import { DesktopApiClient } from "../../api/client"
import { HudButton } from "../hud/HudButton"
import "./backend-startup.css"

export function BackendStartup({ children }: { children: (notice: ReactNode) => ReactNode }) {
	const [status, setStatus] = useState<BackendStatus>({ state: "starting", message: "Starting Robozium…" })
	const [connected, setConnected] = useState(false)
	const [attempt, setAttempt] = useState(0)
	const dockerReady = useRef(false)

	useEffect(() => {
		let active = true
		let timer: ReturnType<typeof setTimeout> | undefined
		const controller = new AbortController()
		let client: DesktopApiClient | undefined
		const fail = (message: string) => { if (active) setStatus({ state: "error", message }) }

		const checkReady = async () => {
			if (!active || !client) return
			const deadline = setTimeout(() => controller.abort(), 3000)
			try {
				const ready = await client.request("/ready", { signal: controller.signal })
				if (!ready || typeof ready !== "object" || !("status" in ready) || ready.status !== "ready") {
					throw new Error("Backend is not ready.")
				}
				if (active) {
					setConnected(true)
					setStatus({ state: "ready", message: "Connected" })
					timer = setTimeout(checkReady, 5000)
				}
			} catch {
				fail("Backend connection unavailable. Check the backend and retry.")
			} finally { clearTimeout(deadline) }
		}

		const checkStartup = async () => {
			try {
				if (!dockerReady.current) {
					const next = await window.robozium.getBackendStatus()
					if (!active) return
					setStatus(next)
					if (next.state !== "ready") {
						if (next.state === "starting") timer = setTimeout(checkStartup, 500)
						return
					}
					dockerReady.current = true
				}
				const connection = await window.robozium.getBackendConnection()
				if (!active) return
				if (connection === null) {
					setConnected(true)
					setStatus({ state: "ready", message: "Local preview" })
					return
				}
				setStatus({ state: "starting", message: "Connecting to the backend…" })
				client = new DesktopApiClient(connection.baseUrl)
				await checkReady()
			} catch { fail("Could not read backend connection information. Restart Robozium.") }
		}
		const start = async () => {
			try {
				if (attempt > 0 && !dockerReady.current) await window.robozium.retryBackend()
				if (active) await checkStartup()
			} catch { fail("Could not retry backend startup. Restart Robozium.") }
		}
		void start()
		return () => {
			active = false
			clearTimeout(timer)
			controller.abort()
		}
	}, [attempt])

	const retry = () => {
		setStatus({ state: "starting", message: "Reconnecting…" })
		setAttempt(value => value + 1)
	}
	const notice = <div className="backend-notice">
		<p role={status.state === "error" ? "alert" : "status"}>{status.message}</p>
		<HudButton disabled={status.state !== "error"} onClick={retry}>Retry</HudButton>
	</div>
	if (connected) return children(status.state === "ready" ? null : notice)
	return <main className="hud-frame backend-startup">
		<h1>Robozium</h1>
		<p role={status.state === "error" ? "alert" : "status"}>{status.message}</p>
		{status.state === "error" && <HudButton onClick={retry}>Retry</HudButton>}
	</main>
}
