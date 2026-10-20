export interface BackendStatus {
	state: "starting" | "ready" | "error"
	message: string
}

/** Live and mock backends share one profile; renderer state is scoped by mode. */
export type BackendMode = "live" | "mock"
export interface BackendConnection { baseUrl: string; mode: BackendMode }

export interface DesktopBridge {
	getBackendConnection(): Promise<BackendConnection | null>
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
