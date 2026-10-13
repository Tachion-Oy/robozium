export interface DesktopBridge {
	getVersion(): Promise<string>
}

declare global {
	interface Window {
		robozium: DesktopBridge
	}
}
