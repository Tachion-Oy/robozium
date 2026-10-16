import { useEffect, useState, type ReactNode } from "react"
import type { BackendStatus } from "../../../../src/bridge"
import { HudButton } from "../hud/HudButton"
import "./backend-startup.css"

export function BackendStartup({ children }: { children: ReactNode }) {
	const [status, setStatus] = useState<BackendStatus>({ state: "starting", message: "Starting Robozium…" })

	useEffect(() => {
		let active = true
		let timer: ReturnType<typeof setTimeout> | undefined

		const poll = async () => {
			try {
				const next = await window.robozium.getBackendStatus()
				if (!active) {
					return
				}
				setStatus(next)
				if (next.state !== "ready") {
					timer = setTimeout(poll, 500)
				}
			} catch {
				if (active) {
					setStatus({ state: "error", message: "Could not read backend startup status. Restart Robozium." })
					timer = setTimeout(poll, 500)
				}
			}
		}
		void poll()
		return () => {
			active = false
			clearTimeout(timer)
		}
	}, [])

	const retry = async () => {
		setStatus({ state: "starting", message: "Retrying backend startup…" })
		try {
			await window.robozium.retryBackend()
		} catch {
			setStatus({ state: "error", message: "Could not retry backend startup. Restart Robozium." })
		}
	}

	if (status.state === "ready") {
		return children
	}
	return <main className="hud-frame backend-startup">
		<h1>Robozium</h1>
		<p role={status.state === "error" ? "alert" : "status"}>{status.message}</p>
		{status.state === "error" && <HudButton onClick={retry}>Retry</HudButton>}
	</main>
}
