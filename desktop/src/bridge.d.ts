export interface BackendStatus {
	state: "starting" | "ready" | "error"
	message: string
}

export interface DesktopBridge {
	getBackendConnection(): Promise<{ baseUrl: string } | null>
	getBackendStatus(): Promise<BackendStatus>
	retryBackend(): Promise<void>
	/** Restart this installation's API container; resolves once it is ready again. */
	restartBackend(): Promise<void>
	/** Recreate the API container from the same image, rereading `.env`; mounted data is kept. */
	recreateBackend(): Promise<void>
	/** Stop the backend and start the app again, so saved settings take effect. */
	restartApp(): Promise<void>
	getVersion(): Promise<string>
	writeClipboardText(text: string): Promise<void>
}

declare global {
	interface Window {
		robozium: DesktopBridge
	}
}
