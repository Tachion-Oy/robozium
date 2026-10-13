import { app, BrowserWindow, ipcMain, protocol } from "electron"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { registerRendererProtocol, rendererUrl } from "./renderer-protocol"

protocol.registerSchemesAsPrivileged([
	{ scheme: "robozium", privileges: { standard: true, secure: true } },
])

app.setName("Robozium")
// Keep this scaffold's Chromium profile separate from the working application.
const profile = path.resolve(process.env.ROBOZIUM_DESKTOP_TEST_DATA
	?? path.join(__dirname, "../../.artifacts/desktop/scaffold"))

async function start(): Promise<void> {
	mkdirSync(profile, { recursive: true, mode: 0o700 })
	app.setPath("userData", profile)
	await app.whenReady()
	await registerRendererProtocol()

	const window = new BrowserWindow({
		width: 900,
		height: 600,
		title: "Robozium",
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
		// Only this window's main document may use the version operation.
		if (window.isDestroyed() || event.sender !== contents
			|| event.senderFrame !== contents.mainFrame
			|| event.senderFrame.url !== rendererUrl) {
			throw new Error("Unauthorized desktop operation.")
		}
		return app.getVersion()
	})
	await window.loadURL(rendererUrl)
	window.show()
}

app.on("window-all-closed", () => app.quit())
void start().catch(error => {
	console.error("Robozium could not start:", error)
	app.exit(1)
})
