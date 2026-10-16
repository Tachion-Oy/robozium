export interface BackendStatus {
	state: "starting" | "ready" | "error"
	message: string
}

export interface DesktopBridge {
	getBackendStatus(): Promise<BackendStatus>
	retryBackend(): Promise<void>
	getVersion(): Promise<string>
	writeClipboardText(text: string): Promise<void>
}

declare global {
	interface Window {
		robozium: DesktopBridge
	}
}
