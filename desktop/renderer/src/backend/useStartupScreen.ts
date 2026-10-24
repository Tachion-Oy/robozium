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
	/** Remove the screen after its fade. */
	dismiss: () => void
	/**
	 * Show the loading screen while `operation` runs; the operation must restart the
	 * readiness checks. A failure removes the screen again. After success it stays
	 * until readiness has left and regained "ready"; `release: false` keeps it, for
	 * an operation that ends the app.
	 */
	cover: <T>(operation: () => Promise<T>, release?: boolean) => Promise<T>
}

/** Running, then waiting for readiness to drop, then for it to return. */
type Cover = "operation" | "reconnecting" | "down" | null

/** Own when the startup screen covers the application: at launch and during restarts. */
export function useStartupScreen(backendReady: boolean): StartupScreenState {
	const [mode, setMode] = useState<StartupScreenMode | null>("intro")
	const [covering, setCovering] = useState<Cover>(null)

	useEffect(() => {
		if (covering === "reconnecting" && !backendReady) setCovering("down")
		else if (covering === "down" && backendReady) setCovering(null)
	}, [covering, backendReady])

	const dismiss = useCallback(() => setMode(null), [])
	const cover = async <T>(operation: () => Promise<T>, release = true): Promise<T> => {
		setMode("loading")
		setCovering("operation")
		try {
			const result = await operation()
			if (release) setCovering("reconnecting")
			return result
		} catch (error) {
			setMode(null)
			setCovering(null)
			throw error
		}
	}
	return { mode, ready: backendReady && covering === null, dismiss, cover }
}
