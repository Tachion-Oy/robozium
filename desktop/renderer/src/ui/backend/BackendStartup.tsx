// Cover the application with the startup screen until the backend is ready and the
// HUD has drawn beneath it, then preserve the mounted app during outages.
// Backend hooks own IPC discovery and HTTP health checks; this component presents their status.
import { useEffect, useState, type ReactNode } from "react"
import { useBackendStartup } from "../../backend/useBackendStartup"
import { useBackendReadiness } from "../../backend/useBackendReadiness"
import { useStartupScreen } from "../../backend/useStartupScreen"
import { StartupScreen, type StartupFailure } from "../startup/StartupScreen"
import { StartupHubFolder } from "./StartupHubFolder"
import { HudButton } from "../hud/HudButton"
import type { DesktopApiClient } from "../../api/client"
import "./backend-startup.css"

/** Backend operations that the startup screen covers while they run. */
export interface BackendOperations {
	/** Restart or recreate the backend container, then reconnect. */
	manage: (operation: "restart" | "recreate") => Promise<void>
	/** Stop the backend and start the app again. */
	restartApp: () => Promise<void>
}

export function BackendStartup({ children }: { children: (notice: ReactNode, client: DesktopApiClient | null, connected: boolean, backend: BackendOperations) => ReactNode }) {
	const { startup, retryStartup } = useBackendStartup()
	const { status: readiness, retryConnection } = useBackendReadiness(startup.state === "ready" ? startup.client : null)
	const [hasOpenedHud, setHasOpenedHud] = useState(false)
	const status = startup.state !== "ready" ? startup
		: startup.client === null ? { state: "ready", message: "Local preview" } : readiness
	const screen = useStartupScreen(status.state === "ready")

	useEffect(() => {
		// Once opened, keep the HUD mounted through outages to retain local UI state.
		if (status.state === "ready") setHasOpenedHud(true)
	}, [status.state])

	const retry = startup.state === "error" ? retryStartup : retryConnection
	const backend: BackendOperations = {
		manage: operation => screen.cover(async () => {
			try { await (operation === "restart" ? window.robozium.restartBackend() : window.robozium.recreateBackend()) }
			// Readiness polling stops while the backend is down; start it again either way.
			finally { retryConnection() }
		}),
		restartApp: () => screen.cover(() => window.robozium.restartApp(), false),
	}
	const notice = <div className="backend-notice">
		<p role={status.state === "error" ? "alert" : "status"}>{status.message}</p>
		<HudButton disabled={status.state !== "error"} onClick={retry}>Retry</HudButton>
	</div>
	const failure: StartupFailure | null = hasOpenedHud || status.state !== "error" ? null : {
		message: status.message,
		actions: startup.state === "error" && startup.action === "choose-hub-folder"
			? <StartupHubFolder onRetry={retryStartup} />
			: <HudButton onClick={retry}>Retry</HudButton>,
	}
	return <>
		{(hasOpenedHud || status.state === "ready") && children(status.state === "ready" ? null : notice, startup.state === "ready" ? startup.client : null, status.state === "ready", backend)}
		{screen.mode && <StartupScreen mode={screen.mode} ready={screen.ready} status={status.message} failure={failure} onFaded={screen.dismiss} />}
	</>
}
