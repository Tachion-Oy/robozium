import { useCallback, useEffect, useState } from "react"

export type StartupScreenMode = "intro" | "loading"

export interface StartupScreenState {
	/** Null once the application has taken over the window. */
	mode: StartupScreenMode | null
	/** The backend is ready and no operation runs, so the screen may fade into the HUD beneath it. */
	ready: boolean
	/** An operation runs or the app exits, so a lost connection is expected rather than a failure. */
	busy: boolean
	/** The app is closing: it stops the runs and the backend, then exits. */
	closing: boolean
	/** Remove the screen after its fade. */
	dismiss: () => void
	/**
	 * Show the loading screen while `operation` runs, then check readiness again; the
	 * screen fades once the backend is ready. A failure removes the screen. `release: false`
	 * keeps the screen after success, for an operation that ends the app.
	 */
	cover: <T>(operation: () => Promise<T>, release?: boolean) => Promise<T>
}

/** Own when the startup screen covers the application: at launch, during restarts and while the app closes. */
export function useStartupScreen(backendReady: boolean, reconnect: () => void): StartupScreenState {
	const [mode, setMode] = useState<StartupScreenMode | null>("intro")
	const [busy, setBusy] = useState(false)
	const [closing, setClosing] = useState(false)

	useEffect(() => window.robozium.onClosing(() => {
		// Nothing follows the close but the exit, so the screen stays.
		setClosing(true)
		setMode("loading")
		setBusy(true)
	}), [])

	const dismiss = useCallback(() => setMode(null), [])
	const cover = async <T>(operation: () => Promise<T>, release = true): Promise<T> => {
		setMode("loading")
		setBusy(true)
		try {
			const result = await operation()
			if (release) {
				// Readiness checks stop while the backend is down. Restarting them marks the
				// backend not ready in the same render that ends the operation.
				reconnect()
				setBusy(false)
			}
			return result
		} catch (error) {
			if (release) reconnect()
			setMode(null)
			setBusy(false)
			throw error
		}
	}
	return { mode, ready: backendReady && !busy, busy, closing, dismiss, cover }
}
