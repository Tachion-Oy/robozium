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
	/** Restart this installation's API container; resolves once it is ready again. */
	restartBackend(): Promise<void>
	/** Recreate the API container from the same image, rereading `.env`; mounted data is kept. */
	recreateBackend(): Promise<void>
	/** Stop the backend and start the app again, so saved settings take effect. */
	restartApp(): Promise<void>
	getVersion(): Promise<string>
	writeClipboardText(text: string): Promise<void>
	/** Whether the message log is open; main keeps it across renderer reloads. */
	getMessageLog(): Promise<{ open: boolean }>
	/** Open or close the message log, growing the window to fit it and restoring it afterwards. */
	setMessageLog(open: boolean): Promise<{ open: boolean }>
	/** Open an http(s) link in the default browser. */
	openExternal(url: string): Promise<void>
	/** Open a hub-relative file or folder with its default application; targets outside the hub are refused. */
	openHubFile(file: string): Promise<void>
}

declare global {
	interface Window {
		robozium: DesktopBridge
	}
}
