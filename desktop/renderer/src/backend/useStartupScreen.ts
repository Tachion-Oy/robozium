import { useCallback, useEffect, useRef, useState } from "react"

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
	 * Show the loading screen while `operation`, which ends the app, runs; it stays after
	 * success. A failure removes the screen. Once the app closes, the operation's end
	 * changes nothing and the promise never settles.
	 */
	cover: <T>(operation: () => Promise<T>) => Promise<T>
}

const untilExit = new Promise<never>(() => {})

/**
 * Own when the startup screen covers the application: at launch, during restarts and while
 * the app closes. The close arrives as main's event, or as the status a document loaded
 * during the close reads at startup.
 */
export function useStartupScreen(backendReady: boolean, stopping: boolean): StartupScreenState {
	const [mode, setMode] = useState<StartupScreenMode | null>("intro")
	const [busy, setBusy] = useState(false)
	const [closing, setClosing] = useState(false)
	const closingNow = useRef(false)

	// Nothing follows the close but the exit, so the screen stays.
	const close = useCallback(() => {
		closingNow.current = true
		setClosing(true)
		setMode("loading")
		setBusy(true)
	}, [])
	useEffect(() => window.robozium.onClosing(close), [close])
	useEffect(() => { if (stopping) close() }, [stopping, close])

	const dismiss = useCallback(() => setMode(null), [])
	const cover = async <T>(operation: () => Promise<T>): Promise<T> => {
		setMode("loading")
		setBusy(true)
		try {
			const result = await operation()
			if (closingNow.current) return await untilExit
			return result
		} catch (error) {
			// The close ends a pending restart; its failure must not uncover the window.
			if (closingNow.current) return await untilExit
			setMode(null)
			setBusy(false)
			throw error
		}
	}
	return { mode, ready: backendReady && !busy, busy, closing, dismiss, cover }
}
