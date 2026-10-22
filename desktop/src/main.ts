import { app, BrowserWindow, clipboard, ipcMain, nativeTheme, protocol, screen, type IpcMainInvokeEvent } from "electron"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { BackendController } from "./backend-controller"
import { registerRendererProtocol, rendererUrl } from "./renderer-protocol"
import { MessageLogWindow } from "./message-log-window"
import { isAppTheme, readSettings, saveSettings, themeBackground, type DesktopSettings } from "./settings"
import { boundedSize, DEFAULT_SIZE, nextZoom, windowLimits, zoomShortcut } from "./window"

protocol.registerSchemesAsPrivileged([
	{ scheme: "robozium", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
])

app.setName("Robozium")
const preview = process.argv.includes("--preview")
const profile = path.resolve(process.env.ROBOZIUM_DESKTOP_TEST_DATA
	?? path.join(__dirname, "../../.artifacts/desktop", preview ? "scaffold" : "data"))

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
			preload: path.join(__dirname, "preload.js"),
			additionalArguments: [`--robozium-theme=${theme}`],
			zoomFactor: settings.zoom,
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
		},
	})
	const backend = preview ? undefined : new BackendController({
		profile, mode: process.argv.includes("--mock") ? "mock" : "live", port: process.env.ROBOZIUM_DESKTOP_API_PORT,
		source: path.join(__dirname, "../.stage/backend"), compose: path.join(__dirname, "../compose.yaml"),
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
	/** Stop the backend, then exit; a restart starts again only after a clean stop. */
	const quit = async (restart = false) => {
		if (closing) return
		closing = true
		window.hide()
		try {
			await backend?.close()
			if (restart) app.relaunch()
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
	contents.session.setPermissionCheckHandler(() => false)
	contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))

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
	await window.loadURL(rendererUrl)
	window.show()
	void startBackend()
}

async function main(): Promise<void> {
	try {
		await start()
	} catch (error) {
		console.error("Robozium could not start:", error)
		app.exit(1)
	}
}

app.on("window-all-closed", () => app.quit())
void main()
