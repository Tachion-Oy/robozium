import { useEffect, useState, type ReactNode } from "react"
import { useBackendStartup } from "./useBackendStartup"
import { useBackendReadiness } from "./useBackendReadiness"
import { HudButton } from "../hud/HudButton"
import type { DesktopApiClient } from "../../api/client"
import "./backend-startup.css"

export function BackendStartup({ children }: { children: (notice: ReactNode, client: DesktopApiClient | null, connected: boolean) => ReactNode }) {
	const { startup, retryStartup } = useBackendStartup()
	const { status: readiness, retryConnection } = useBackendReadiness(startup.state === "ready" ? startup.client : null)
	const [hasOpenedHud, setHasOpenedHud] = useState(false)
	const status = startup.state !== "ready" ? startup
		: startup.client === null ? { state: "ready", message: "Local preview" } : readiness

	useEffect(() => {
		// Once opened, keep the HUD mounted through outages to retain local UI state.
		if (status.state === "ready") setHasOpenedHud(true)
	}, [status.state])

	const retry = startup.state === "error" ? retryStartup : retryConnection
	const notice = <div className="backend-notice">
		<p role={status.state === "error" ? "alert" : "status"}>{status.message}</p>
		<HudButton disabled={status.state !== "error"} onClick={retry}>Retry</HudButton>
	</div>
	if (hasOpenedHud || status.state === "ready") return children(status.state === "ready" ? null : notice, startup.state === "ready" ? startup.client : null, status.state === "ready")
	return <main className="hud-frame backend-startup">
		<h1>Robozium</h1>
		<p role={status.state === "error" ? "alert" : "status"}>{status.message}</p>
		{status.state === "error" && <HudButton onClick={retry}>Retry</HudButton>}
	</main>
}
