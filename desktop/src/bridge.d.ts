export interface BackendStatus {
	state: "starting" | "ready" | "error"
	message: string
}

export interface DesktopBridge {
	getBackendConnection(): Promise<{ baseUrl: string } | null>
	getBackendStatus(): Promise<BackendStatus>
	retryBackend(): Promise<void>
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
