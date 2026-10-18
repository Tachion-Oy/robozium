export interface BackendStatus {
	state: "starting" | "ready" | "error"
	message: string
}

export type BackendMode = "live" | "mock"
export interface BackendConnection { baseUrl: string; mode: BackendMode }

export interface DesktopBridge {
	getBackendConnection(): Promise<BackendConnection | null>
	getBackendStatus(): Promise<BackendStatus>
	retryBackend(): Promise<void>
	getVersion(): Promise<string>
	writeClipboardText(text: string): Promise<void>
}

export interface PreparationBridge {
	status(): Promise<{ message: string; failed: boolean; retry: boolean; ready: boolean }>
	retry(): Promise<void>
	painted(): Promise<void>
	report(status: BackendStatus): Promise<void>
	finished(): Promise<void>
}

declare global {
	interface Window {
		robozium: DesktopBridge
		roboziumStartup: PreparationBridge
	}
}
