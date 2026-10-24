import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, protocol, screen, shell, type IpcMainInvokeEvent } from "electron"
import { mkdirSync } from "node:fs"
import { BackendController } from "./backend-controller.ts"
import { registerRendererProtocol, rendererUrl } from "./renderer-protocol.ts"
import { MessageLogWindow } from "./message-log-window.ts"
import { externalUrl, hubFilePath } from "./links.ts"
import { checkHubFolderChoice, recordedHubFolder, saveHubFolder } from "./hub-folder.ts"
import { permissionAllowed, permissionRequestAllowed } from "./security.ts"
import { desktopLocations } from "./locations.ts"
import { isAppTheme, readSettings, saveSettings, themeBackground, type DesktopSettings } from "./settings.ts"
import { boundedSize, DEFAULT_SIZE, nextZoom, windowLimits, zoomShortcut } from "./window.ts"

protocol.registerSchemesAsPrivileged([
	{ scheme: "robozium", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
])

app.setName("Robozium")
const preview = process.argv.includes("--preview")
const mode = process.argv.includes("--mock") ? "mock" : "live"
const { profile, source, compose, preload, hubFolder } = desktopLocations({
	packaged: app.isPackaged, appDirectory: import.meta.dirname, resourcesPath: process.resourcesPath,
	userData: app.getPath("userData"), home: app.getPath("home"), mode, preview,
	profileOverride: process.env.ROBOZIUM_DESKTOP_TEST_DATA,
})

async function start(): Promise<void> {
	mkdirSync(profile, { recursive: true, mode: 0o700 })
	app.setPath("userData", profile)
	// A second process must not take over or stop the same installation's backend.
	if (!preview && !app.requestSingleInstanceLock()) { app.exit(0); return }
	await app.whenReady()

	const settings = readSettings(profile)
	const theme = settings.theme
	nativeTheme.themeSource = theme
	// The app picks at most 90% of the work area; the user may resize further.
	const size = boundedSize(settings.window ?? DEFAULT_SIZE, windowLimits(screen.getPrimaryDisplay().workArea))
	const window = new BrowserWindow({
		...size,
		useContentSize: true,
		title: "Robozium",
		show: false,
		backgroundColor: themeBackground[theme],
		webPreferences: {
			preload,
			additionalArguments: [`--robozium-theme=${theme}`],
			zoomFactor: settings.zoom,
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
		},
	})
	const backend = preview ? undefined : new BackendController({
		profile, mode, port: process.env.ROBOZIUM_DESKTOP_API_PORT,
		source, compose, hubFolder,
	})
	await registerRendererProtocol(backend?.connection().baseUrl)
	const startBackend = async () => {
		try {
			await backend?.start()
		} catch {
			// The controller exposes startup failures through its status for the UI.
		}
	}
	let closing = false
	let relaunch = false
	/** Stop the backend, then exit; a restart starts again only after a clean stop. */
	const quit = async (restart = false) => {
		if (closing) {
			// Closing during a restart hides the window at once and exits without starting again.
			if (!restart) { relaunch = false; window.hide() }
			return
		}
		closing = true
		relaunch = restart
		// A restart keeps the window, which shows the startup screen until the app exits.
		if (!restart) window.hide()
		try {
			await backend?.close()
			if (relaunch) app.relaunch()
			app.exit(0)
		} catch (error) { console.error("Backend shutdown failed:", error); app.exit(1) }
	}
	/** Preferences are conveniences: a failed save must not interrupt the window. */
	const save = (changes: Partial<DesktopSettings>) => {
		try {
			saveSettings(profile, changes)
		} catch (error) { console.error("Settings could not be saved:", error) }
	}
	const logWindow = new MessageLogWindow(window, bounds => screen.getDisplayMatching(bounds))
	let savedSize = size
	/** Write only real changes; startup's own sizing is not a preference. */
	const saveSize = () => {
		if (window.isDestroyed()) return
		const next = logWindow.savedSize()
		if (next.width === savedSize.width && next.height === savedSize.height) return
		savedSize = next
		save({ window: next })
	}
	let resizeTimer: NodeJS.Timeout | undefined
	// GNOME's frame metrics settle when its native title bar is first shown.
	window.once("show", () => window.setContentSize(size.width, size.height))
	window.setMinimumSize(640, 420)
	window.on("will-resize", () => { if (logWindow.open) logWindow.manuallyResized = true })
	window.on("resize", () => {
		logWindow.resized()
		clearTimeout(resizeTimer)
		resizeTimer = setTimeout(saveSize, 250)
	})
	window.on("close", event => { event.preventDefault(); clearTimeout(resizeTimer); saveSize(); void quit() })
	// The lock above makes later launches exit; bring this window forward instead.
	app.on("second-instance", () => {
		if (closing) return
		if (window.isMinimized()) window.restore()
		window.show()
		window.focus()
	})
	app.on("before-quit", event => { event.preventDefault(); void quit() })
	window.setMenuBarVisibility(false)
	const contents = window.webContents
	let zoom = settings.zoom
	contents.on("before-input-event", (event, input) => {
		const direction = zoomShortcut(input, process.platform)
		if (direction === null) return
		// Match logical keys across layouts/keypads and suppress the menu's second step.
		event.preventDefault()
		zoom = nextZoom(contents.getZoomFactor(), direction)
		contents.setZoomFactor(zoom)
		if (logWindow.open) logWindow.expand()
		save({ zoom })
	})
	// A reload resets the document's zoom; keep the chosen one.
	contents.on("dom-ready", () => contents.setZoomFactor(zoom))
	contents.setWindowOpenHandler(() => ({ action: "deny" }))
	contents.on("will-navigate", event => event.preventDefault())
	contents.on("will-frame-navigate", event => event.preventDefault())
	contents.on("will-redirect", event => event.preventDefault())
	contents.on("will-attach-webview", event => event.preventDefault())
	// Only the bundled document's main frame may record audio, for dictation.
	contents.session.setPermissionCheckHandler((requester, permission, _origin, details) =>
		permissionAllowed(window, requester, rendererUrl, permission, details))
	contents.session.setPermissionRequestHandler((requester, permission, callback, details) =>
		callback(permissionRequestAllowed(window, requester, rendererUrl, permission, details)))

	const requireTrustedDocument = (event: IpcMainInvokeEvent) => {
		// Only this window's main document may use desktop operations.
		if (window.isDestroyed() || event.sender !== contents
			|| event.senderFrame !== contents.mainFrame
			|| event.senderFrame.url !== rendererUrl) {
			throw new Error("Unauthorized desktop operation.")
		}
	}
	ipcMain.handle("desktop:backend-status", event => {
		requireTrustedDocument(event)
		return backend?.snapshot() ?? { state: "ready", message: "Local preview" }
	})
	ipcMain.handle("desktop:backend-connection", event => {
		requireTrustedDocument(event)
		return backend?.connection() ?? null
	})
	ipcMain.handle("desktop:retry-backend", event => {
		requireTrustedDocument(event)
		void startBackend()
	})
	const manageBackend = (operation: "restart" | "recreate") => async (event: IpcMainInvokeEvent) => {
		requireTrustedDocument(event)
		if (!backend) throw new Error("Standalone preview has no backend to manage.")
		await (operation === "restart" ? backend.restart() : backend.recreate())
	}
	ipcMain.handle("desktop:restart-backend", manageBackend("restart"))
	ipcMain.handle("desktop:recreate-backend", manageBackend("recreate"))
	ipcMain.handle("desktop:relaunch", event => {
		requireTrustedDocument(event)
		void quit(true)
	})
	ipcMain.handle("desktop:version", event => {
		requireTrustedDocument(event)
		return app.getVersion()
	})
	ipcMain.handle("desktop:set-theme", (event, theme: unknown) => {
		requireTrustedDocument(event)
		if (!isAppTheme(theme)) throw new TypeError("Theme must be dark or light.")
		// The window follows the choice even when saving it fails.
		nativeTheme.themeSource = theme
		window.setBackgroundColor(themeBackground[theme])
		saveSettings(profile, { theme })
	})
	ipcMain.handle("desktop:message-log", event => {
		requireTrustedDocument(event)
		return { open: logWindow.open }
	})
	ipcMain.handle("desktop:set-message-log", (event, open: unknown) => {
		requireTrustedDocument(event)
		return logWindow.setOpen(open)
	})
	ipcMain.handle("desktop:write-clipboard-text", (event, text: unknown) => {
		requireTrustedDocument(event)
		if (typeof text !== "string") throw new TypeError("Clipboard text must be a string.")
		clipboard.writeText(text)
	})
	ipcMain.handle("desktop:open-external", async (event, url: unknown) => {
		requireTrustedDocument(event)
		await shell.openExternal(externalUrl(url))
	})
	ipcMain.handle("desktop:open-hub-file", async (event, file: unknown) => {
		requireTrustedDocument(event)
		if (!backend) throw new Error("The standalone preview has no hub files.")
		const failure = await shell.openPath(await hubFilePath(backend.hubDirectory, file))
		if (failure) throw new Error(failure)
	})
	const currentHub = () => {
		try { return backend?.hubDirectory ?? null } catch { return null }
	}
	const hubFolderStatus = () => ({
		current: currentHub(),
		selected: hubFolder ? recordedHubFolder(hubFolder) ?? hubFolder.defaultFolder : null,
		choosable: hubFolder !== null,
	})
	/** Only a folder the user picked in the dialog may be recorded. */
	let pickedHubFolder: string | null = null
	ipcMain.handle("desktop:hub-folder", event => {
		requireTrustedDocument(event)
		return hubFolderStatus()
	})
	ipcMain.handle("desktop:choose-hub-folder", async event => {
		requireTrustedDocument(event)
		if (!hubFolder) throw new Error("This launch keeps its own hub folder.")
		const result = await dialog.showOpenDialog(window, {
			title: "Choose hub folder", buttonLabel: "Use folder",
			defaultPath: recordedHubFolder(hubFolder) ?? hubFolder.defaultFolder,
			properties: ["openDirectory", "createDirectory"],
		})
		pickedHubFolder = null
		if (result.canceled || result.filePaths.length === 0) return null
		const choice = checkHubFolderChoice(result.filePaths[0], profile, app.getPath("temp"))
		pickedHubFolder = choice.folder
		return choice
	})
	ipcMain.handle("desktop:use-hub-folder", event => {
		requireTrustedDocument(event)
		if (!hubFolder || !pickedHubFolder) throw new Error("Choose a hub folder first.")
		// Checked again: the folder may have changed while the confirmation was open.
		saveHubFolder(hubFolder, checkHubFolderChoice(pickedHubFolder, profile, app.getPath("temp")).folder)
		pickedHubFolder = null
		return hubFolderStatus()
	})
	ipcMain.handle("desktop:open-hub-folder", async event => {
		requireTrustedDocument(event)
		const folder = currentHub()
		if (!folder) throw new Error("The hub folder is not in use yet.")
		const failure = await shell.openPath(folder)
		if (failure) throw new Error(failure)
	})
	await window.loadURL(rendererUrl)
	window.show()
	void startBackend()
}

async function main(): Promise<void> {
	try {
		await start()
	} catch (error) {
		console.error("Robozium could not start:", error)
		// Without a window the failure would otherwise be visible only in a terminal.
		dialog.showErrorBox("Robozium could not start", error instanceof Error ? error.message : String(error))
		app.exit(1)
	}
}

app.on("window-all-closed", () => app.quit())
void main()
