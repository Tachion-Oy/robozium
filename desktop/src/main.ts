import { app, BrowserWindow, clipboard, ipcMain, nativeTheme, protocol, type IpcMainInvokeEvent } from "electron"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { BackendController } from "./backend-controller"
import { registerRendererProtocol, rendererUrl } from "./renderer-protocol"
import { isAppTheme, readTheme, saveTheme, themeBackground } from "./settings"

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

	const theme = readTheme(profile)
	nativeTheme.themeSource = theme
	const window = new BrowserWindow({
		width: 900,
		height: 600,
		title: "Robozium",
		show: false,
		backgroundColor: themeBackground[theme],
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			additionalArguments: [`--robozium-theme=${theme}`],
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
	window.on("close", event => { event.preventDefault(); void quit() })
	app.on("before-quit", event => { event.preventDefault(); void quit() })
	window.setMenuBarVisibility(false)
	const contents = window.webContents
	contents.on("before-input-event", (event, input) => {
		const modifier = process.platform === "darwin"
			? input.meta && !input.control : input.control && !input.meta
		if (input.type !== "keyDown" || !modifier || input.alt || input.isComposing) return
		let level = contents.getZoomLevel()
		switch (input.key) {
			case "+":
			case "=": level += 0.5; break
			case "-": level -= 0.5; break
			case "0": level = 0; break
			default: return
		}
		// Match logical keys across layouts/keypads and suppress the menu's second step.
		event.preventDefault()
		contents.setZoomLevel(level)
	})
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
		saveTheme(profile, theme)
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
