import { app, BrowserWindow, ipcMain } from "electron"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

app.setName("Robozium Desktop")
// Keep this scaffold's Chromium profile separate from the working application.
const profile = path.resolve(process.env.ROBOZIUM_DESKTOP_TEST_DATA
	?? path.join(__dirname, "../../.artifacts/desktop/scaffold"))
const documentPath = path.join(__dirname, "../renderer/index.html")
const documentUrl = pathToFileURL(documentPath).href

async function start(): Promise<void> {
	mkdirSync(profile, { recursive: true, mode: 0o700 })
	app.setPath("userData", profile)
	await app.whenReady()

	const window = new BrowserWindow({
		width: 900,
		height: 600,
		title: "Robozium Desktop",
		show: false,
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
		},
	})
	window.setMenuBarVisibility(false)
	const contents = window.webContents
	contents.setWindowOpenHandler(() => ({ action: "deny" }))
	contents.on("will-navigate", event => event.preventDefault())
	contents.on("will-frame-navigate", event => event.preventDefault())
	contents.on("will-redirect", event => event.preventDefault())
	contents.on("will-attach-webview", event => event.preventDefault())
	contents.session.setPermissionCheckHandler(() => false)
	contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))

	ipcMain.handle("desktop:version", event => {
		// file: documents share an opaque origin; trust this exact document instead.
		if (window.isDestroyed() || event.sender !== contents
			|| event.senderFrame !== contents.mainFrame
			|| event.senderFrame.url !== documentUrl) {
			throw new Error("Unauthorized desktop operation.")
		}
		return app.getVersion()
	})
	await window.loadFile(documentPath)
	window.show()
}

app.on("window-all-closed", () => app.quit())
void start().catch(error => {
	console.error("Robozium Desktop could not start:", error)
	app.exit(1)
})
