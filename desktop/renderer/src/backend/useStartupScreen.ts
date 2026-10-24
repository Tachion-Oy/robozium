import { useCallback, useEffect, useState } from "react"

export type StartupScreenMode = "intro" | "loading"

export interface StartupScreenState {
	/** Null once the application has taken over the window. */
	mode: StartupScreenMode | null
	/**
	 * The backend is ready, so the application is rendered beneath the screen and
	 * the screen may fade. Both share one document, so no blank frame shows between them.
	 */
	ready: boolean
	/** An operation is running or the app is exiting, so a lost connection is expected, not a failure. */
	busy: boolean
	/** What the running operation is doing, shown while the screen is busy. */
	activity: string | null
	/** Remove the screen after its fade. */
	dismiss: () => void
	/**
	 * Show the loading screen while `operation` runs, then restart the readiness
	 * checks. A failure removes the screen again. After success it stays until
	 * readiness has left and regained "ready". `release: false` keeps the screen
	 * busy after success, for an operation that ends the app.
	 */
	cover: <T>(operation: () => Promise<T>, activity: string, release?: boolean) => Promise<T>
}

/** Running, then waiting for readiness to drop, then for it to return. */
type Cover = "operation" | "reconnecting" | "down" | null

/** Own when the startup screen covers the application: at launch and during restarts. */
export function useStartupScreen(backendReady: boolean, reconnect: () => void): StartupScreenState {
	const [mode, setMode] = useState<StartupScreenMode | null>("intro")
	const [covering, setCovering] = useState<Cover>(null)
	const [activity, setActivity] = useState<string | null>(null)

	useEffect(() => {
		if (covering === "reconnecting" && !backendReady) setCovering("down")
		else if (covering === "down" && backendReady) setCovering(null)
	}, [covering, backendReady])

	const dismiss = useCallback(() => setMode(null), [])
	const cover = async <T>(operation: () => Promise<T>, activity: string, release = true): Promise<T> => {
		setActivity(activity)
		setMode("loading")
		setCovering("operation")
		try {
			const result = await operation()
			if (release) {
				// Readiness checks stop while the backend is down; both updates render together.
				reconnect()
				setCovering("reconnecting")
			}
			return result
		} catch (error) {
			if (release) reconnect()
			setMode(null)
			setCovering(null)
			throw error
		}
	}
	const busy = covering === "operation"
	return { mode, ready: backendReady && covering === null, busy, activity: busy ? activity : null, dismiss, cover }
}
