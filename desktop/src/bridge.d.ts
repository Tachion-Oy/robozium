export interface DesktopBridge {
	getVersion(): Promise<string>
	writeClipboardText(text: string): Promise<void>
}

declare global {
	interface Window {
		robozium: DesktopBridge
	}
}
