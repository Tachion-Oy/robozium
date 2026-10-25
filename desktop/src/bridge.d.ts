// The desktop bridge contract shared by main, preload and the renderer. It imports nothing,
// so the renderer's browser type check never sees Node or Electron types.
export interface BackendStatus {
	state: "starting" | "ready" | "error"
	message: string
	/** The failure is the hub folder's: the user can choose another one, then retry. */
	action?: "choose-hub-folder"
}

/** The hub folder this launch mounts and the one recorded for the next launch. */
export interface HubFolderStatus {
	/** The folder the running backend mounts; null before it launches. */
	current: string | null
	/** The folder the next launch uses: the chosen one, else the default; null when not choosable. */
	selected: string | null
	/** False for mock mode and previews, which keep a throwaway hub of their own. */
	choosable: boolean
}

/** A folder picked in the native dialog; a non-empty folder without hub files needs confirming first. */
export type HubFolderPick = { folder: string; needsConfirmation: boolean } | null

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
	/** The startup screen is rendered in its loaded fonts; the hidden window shows. */
	painted(): Promise<void>
	writeClipboardText(text: string): Promise<void>
	/** Whether the message log is open; main keeps it across renderer reloads. */
	getMessageLog(): Promise<{ open: boolean }>
	/** Open or close the message log, growing the window to fit it and restoring it afterwards. */
	setMessageLog(open: boolean): Promise<{ open: boolean }>
	/** Open an http(s) link in the default browser. */
	openExternal(url: string): Promise<void>
	/** Open a hub-relative file or folder with its default application; targets outside the hub are refused. */
	openHubFile(file: string): Promise<void>
	getHubFolder(): Promise<HubFolderStatus>
	/** Pick a hub folder with the native folder dialog; null when cancelled. Errors explain a refused folder. */
	chooseHubFolder(): Promise<HubFolderPick>
	/** Record the last picked folder for the next launch. */
	useHubFolder(): Promise<HubFolderStatus>
	/** Open the hub folder in the file manager. */
	openHubFolder(): Promise<void>
}

declare global {
	interface Window {
		robozium: DesktopBridge
	}
}
