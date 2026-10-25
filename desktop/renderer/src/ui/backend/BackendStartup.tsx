// Cover the application with the startup screen until the backend is ready and the
// HUD has drawn beneath it, then preserve the mounted app during outages.
// Backend hooks own IPC discovery and HTTP health checks; this component presents their status.
import { useEffect, useState } from "react"
import { useBackendStartup } from "../../backend/useBackendStartup"
import { useBackendReadiness } from "../../backend/useBackendReadiness"
import { useStartupScreen } from "../../backend/useStartupScreen"
import { App } from "../app/App"
import { StartupScreen, type StartupFailure } from "../startup/StartupScreen"
import { StartupHubFolder } from "./StartupHubFolder"
import { HudButton } from "../HudButton"
import "./backend-startup.css"

/** Backend operations that the startup screen covers while they run. */
export interface BackendOperations {
	/** Restart or recreate the backend container, then reconnect. */
	manage: (operation: "restart" | "recreate") => Promise<void>
	/** Stop the backend and start the app again. */
	restartApp: () => Promise<void>
}

export function BackendStartup() {
	const { startup, retryStartup } = useBackendStartup()
	const { status: readiness, retryConnection } = useBackendReadiness(startup.state === "ready" ? startup.client : null)
	const [hasOpenedHud, setHasOpenedHud] = useState(false)
	const status = startup.state !== "ready" ? startup : readiness
	const screen = useStartupScreen(status.state === "ready", retryConnection)

	useEffect(() => {
		// Once opened, keep the HUD mounted through outages to retain local UI state.
		if (status.state === "ready") setHasOpenedHud(true)
	}, [status.state])

	const retry = startup.state === "error" ? retryStartup : retryConnection
	const backend: BackendOperations = {
		manage: operation => screen.cover(() => operation === "restart" ? window.robozium.restartBackend() : window.robozium.recreateBackend()),
		restartApp: () => screen.cover(() => window.robozium.restartApp(), false),
	}
	const notice = <div className="backend-notice">
		<p role={status.state === "error" ? "alert" : "status"}>{status.message}</p>
		<HudButton disabled={status.state !== "error"} onClick={retry}>Retry</HudButton>
	</div>
	// The screen shows failures while it covers the app, including a reconnect after a
	// restart, but not the expected outage while an operation runs or the app exits.
	const covered = screen.mode !== null && !screen.busy
	const failure: StartupFailure | null = status.state !== "error" || (hasOpenedHud && !covered) ? null : {
		message: status.message,
		actions: startup.state === "error" && startup.action === "choose-hub-folder"
			? <StartupHubFolder onRetry={retryStartup} />
			: <HudButton onClick={retry}>Retry</HudButton>,
	}
	return <>
		{/* The covered HUD stays mounted, but focus and assistive technology cannot reach it. */}
		<div className="backend-startup__app" inert={screen.mode !== null}>
			{/* Startup stays ready once reached, so the app always has its client. */}
			{startup.state === "ready" && (hasOpenedHud || status.state === "ready") && <App
				connectionNotice={status.state === "ready" ? null : notice}
				client={startup.client}
				connected={status.state === "ready"}
				backend={backend} />}
		</div>
		{screen.mode && <StartupScreen mode={screen.mode} ready={screen.ready} status={status.message} failure={failure} onFaded={screen.dismiss} />}
	</>
}
