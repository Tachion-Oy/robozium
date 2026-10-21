export interface BackendStatus {
	state: "starting" | "ready" | "error"
	message: string
}

export type AppTheme = "dark" | "light"

export interface DesktopBridge {
	/** The saved theme at launch, so the renderer can apply it before first paint. */
	readonly theme: AppTheme
	/** Save the theme and match the native window background to it. */
	setTheme(theme: AppTheme): Promise<void>
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
