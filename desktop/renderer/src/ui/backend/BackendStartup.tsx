// Cover the application with the startup screen until the backend is ready and the
// HUD has drawn beneath it, then preserve the mounted app during outages.
// Backend hooks own IPC discovery and HTTP health checks; this component presents their status.
// Failures and outages are toasts over the screen or the HUD, so nothing moves.
import { useEffect, useState } from "react"
import { useBackendStartup } from "../../backend/useBackendStartup"
import { useBackendReadiness } from "../../backend/useBackendReadiness"
import { useStartupScreen } from "../../backend/useStartupScreen"
import { usePersistentToast } from "../../feedback/notices"
import { App } from "../app/App"
import { ToastViewport } from "../feedback/ToastViewport"
import { StartupScreen } from "../startup/StartupScreen"
import { StartupHubFolder } from "./StartupHubFolder"
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
	// Failures show, with Retry, except during the expected outage while an operation runs
	// or the app exits; a reconnect in progress shows only over the open HUD.
	const expectedOutage = screen.mode !== null && screen.busy
	const hubFolderFailure = startup.state === "error" && startup.action === "choose-hub-folder"
	usePersistentToast("backend", status.state === "ready" || expectedOutage || hubFolderFailure ? null
		: status.state === "error" ? {
			tone: "error",
			title: startup.state === "error" ? "Robozium could not start" : "Backend unavailable",
			message: status.message,
			actions: [{ label: "Retry", onClick: retry }],
		}
		: hasOpenedHud && screen.mode === null ? { tone: "warning", title: "Backend connection", message: status.message }
		: null)
	return <>
		{/* The covered HUD stays mounted, but focus and assistive technology cannot reach it. */}
		<div className="backend-startup__app" inert={screen.mode !== null}>
			{/* Startup stays ready once reached, so the app always has its client. */}
			{startup.state === "ready" && (hasOpenedHud || status.state === "ready") && <App
				client={startup.client}
				connected={status.state === "ready"}
				covered={screen.mode !== null}
				backend={backend} />}
		</div>
		{screen.mode && <StartupScreen mode={screen.mode} ready={screen.ready} status={status.message} onFaded={screen.dismiss} />}
		{hubFolderFailure && !expectedOutage && <StartupHubFolder message={status.message} onRetry={retryStartup} />}
		<ToastViewport />
	</>
}
