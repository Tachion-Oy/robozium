// Gate initial rendering on backend readiness, then preserve the mounted app during outages.
// Backend hooks own IPC discovery and HTTP health checks; this component presents their status.
import { useEffect, useState, type ReactNode } from "react"
import { useBackendStartup } from "../../backend/useBackendStartup"
import { useBackendReadiness } from "../../backend/useBackendReadiness"
import { StartupHubFolder } from "./StartupHubFolder"
import { HudButton } from "../HudButton"
import type { DesktopApiClient } from "../../api/client"
import "./backend-startup.css"

export function BackendStartup({ children }: { children: (notice: ReactNode, client: DesktopApiClient | null, connected: boolean, reconnect: () => void) => ReactNode }) {
	const { startup, retryStartup } = useBackendStartup()
	const { status: readiness, retryConnection } = useBackendReadiness(startup.state === "ready" ? startup.client : null)
	const [hasOpenedHud, setHasOpenedHud] = useState(false)
	const status = startup.state !== "ready" ? startup
		: startup.client === null ? { state: "ready", message: "Local preview" } : readiness

	useEffect(() => {
		// Once opened, keep the HUD mounted through outages to retain local UI state.
		if (status.state === "ready") setHasOpenedHud(true)
	}, [status.state])

	// Main's startup screen shows Docker startup failures itself; the hub folder choice
	// and connection failures are this component's, so the screen gives way to them.
	const painted = status.state === "ready" || (status.state === "error"
		&& (startup.state === "ready" || startup.action === "choose-hub-folder"))
	useEffect(() => {
		if (!painted) return
		// The screen fades once the HUD or this failure has painted beneath it.
		let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => { void window.robozium.ready() }) })
		return () => cancelAnimationFrame(frame)
	}, [painted])

	const retry = startup.state === "error" ? retryStartup : retryConnection
	const notice = <div className="backend-notice">
		<p role={status.state === "error" ? "alert" : "status"}>{status.message}</p>
		<HudButton disabled={status.state !== "error"} onClick={retry}>Retry</HudButton>
	</div>
	if (hasOpenedHud || status.state === "ready") return children(status.state === "ready" ? null : notice, startup.state === "ready" ? startup.client : null, status.state === "ready", retryConnection)
	return <main className="hud-frame backend-startup">
		<h1>Robozium</h1>
		<p role={status.state === "error" ? "alert" : "status"}>{status.message}</p>
		{startup.state === "error" && startup.action === "choose-hub-folder"
			? <StartupHubFolder onRetry={retryStartup} />
			: status.state === "error" && <HudButton onClick={retry}>Retry</HudButton>}
	</main>
}
