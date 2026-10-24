import { useCallback, useState } from "react"

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
	 * Show the loading screen while `operation` runs. A failure removes it again;
	 * `release: false` keeps it after success, for an operation that ends the app.
	 */
	cover: <T>(operation: () => Promise<T>, release?: boolean) => Promise<T>
}

/** Own when the startup screen covers the application: at launch and during restarts. */
export function useStartupScreen(backendReady: boolean): StartupScreenState {
	const [mode, setMode] = useState<StartupScreenMode | null>("intro")
	const [covering, setCovering] = useState(false)

	const dismiss = useCallback(() => setMode(null), [])
	const cover = async <T>(operation: () => Promise<T>, release = true): Promise<T> => {
		setMode("loading")
		setCovering(true)
		try {
			const result = await operation()
			if (release) setCovering(false)
			return result
		} catch (error) {
			setMode(null)
			setCovering(false)
			throw error
		}
	}
	return { mode, ready: backendReady && !covering, dismiss, cover }
}
