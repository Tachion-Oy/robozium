// This entry and the splash are deliberately uncompiled: show the window before
// development preparation, then load the compiled application into that window.
const { app, BrowserWindow, WebContentsView, ipcMain, protocol } = require("electron")
const { mkdirSync } = require("node:fs")
const path = require("node:path")
const process = require("node:process")
const console = require("node:console")
const { setImmediate } = require("node:timers")
const { pathToFileURL } = require("node:url")
const { prepareDesktop } = require("./prepare-desktop.cjs")

protocol.registerSchemesAsPrivileged([
	{ scheme: "robozium", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
])
app.setName("Robozium")

async function start() {
	const root = path.resolve(__dirname, "..")
	const preview = process.argv.includes("--preview")
	const profile = path.resolve(process.env.ROBOZIUM_DESKTOP_TEST_DATA
		?? path.join(root, "../.artifacts/desktop", preview ? "scaffold" : "data"))
	mkdirSync(profile, { recursive: true, mode: 0o700 })
	app.setPath("userData", profile)
	// Claim ownership before preparing files or touching the backend.
	if (!preview && !app.requestSingleInstanceLock()) { app.exit(0); return }
	await app.whenReady()
	const window = new BrowserWindow({
		width: 900, height: 600, title: "Robozium", show: false, backgroundColor: "#091426",
		webPreferences: {
			preload: path.join(__dirname, "preload.cjs"),
			sandbox: true, contextIsolation: true, nodeIntegration: false,
		},
	})
	window.setMenuBarVisibility(false)
	const splashView = new WebContentsView({ webPreferences: {
		preload: path.join(__dirname, "preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false,
	} })
	const splashContents = splashView.webContents
	splashView.setBackgroundColor("#00000000")
	window.contentView.addChildView(splashView)
	const resize = () => { const [width, height] = window.getContentSize(); splashView.setBounds({ x: 0, y: 0, width, height }) }
	resize()
	window.on("resize", resize)
	for (const contents of [window.webContents, splashContents]) {
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
			window.webContents.setZoomLevel(level)
			if (!splashContents.isDestroyed()) splashContents.setZoomLevel(level)
		})
		contents.setWindowOpenHandler(() => ({ action: "deny" }))
		contents.on("will-navigate", event => event.preventDefault())
		contents.on("will-frame-navigate", event => event.preventDefault())
		contents.on("will-redirect", event => event.preventDefault())
		contents.on("will-attach-webview", event => event.preventDefault())
		contents.session.setPermissionCheckHandler(() => false)
		contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
	}
	const controller = new AbortController()
	/** @type {Promise<void> | undefined} */
	let pending
	/** @type {(() => Promise<void>) | undefined} */
	let shutdown
	const quit = async () => {
		if (controller.signal.aborted) return
		controller.abort()
		window.hide()
		try { await pending; await shutdown?.(); app.exit(0) }
		catch (error) { console.error("Desktop shutdown failed:", error); app.exit(1) }
	}
	window.on("close", event => { event.preventDefault(); void quit() })
	app.on("before-quit", event => { event.preventDefault(); void quit() })
	const splash = path.join(__dirname, "../splash/index.html")
	/** @type {{ message: string; failed: boolean; retry: boolean }} */
	let status = { message: "Starting Robozium…", failed: false, retry: false }
	let ready = false
	let dismissed = false
	/** @type {Awaited<ReturnType<typeof import("./main").start>> | undefined} */
	let application
	/** @type {import("./bridge").BackendStatus | undefined} */
	let rendererStatus
	/** @param {import("electron").IpcMainInvokeEvent} event */
	const trustedRenderer = event => {
		if (window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
			|| event.senderFrame.url !== "robozium://app/index.html") throw new Error("Unauthorized startup operation.")
	}
	/** @param {import("electron").IpcMainInvokeEvent} event */
	const trustedSplash = event => {
		if (window.isDestroyed() || event.sender !== splashContents || event.senderFrame !== splashContents.mainFrame
			|| event.senderFrame.url !== pathToFileURL(splash).href) throw new Error("Unauthorized startup operation.")
	}
	const prepare = async () => {
		let prepared = false
		try {
			if (process.argv.includes("--prepare")) {
				await prepareDesktop(root, !preview, controller.signal, message => { status = { message, failed: false, retry: false } })
			}
			controller.signal.throwIfAborted()
			prepared = true
			status = { message: "Opening Robozium…", failed: false, retry: false }
			const { start } = /** @type {typeof import("./main")} */ (require(path.join(root, "dist/main.js")))
			application = await start(window, { profile, preview, signal: controller.signal, onShutdown: close => { shutdown = close } })
		} catch (error) {
			if (!controller.signal.aborted) {
				console.error("Robozium could not start:", error)
				status = { message: prepared ? "Could not open Robozium. Check the terminal and restart the app."
					: error instanceof Error ? error.message : "Startup preparation failed. Check the terminal and retry.",
				failed: true, retry: !prepared }
			}
		} finally { pending = undefined }
	}
	ipcMain.handle("desktop:preparation-status", event => {
		trustedSplash(event)
		let backend = application?.snapshot()
		if (backend?.state === "ready" && rendererStatus) backend = rendererStatus
		return backend ? { message: backend.state === "ready" ? "Opening Robozium…" : backend.message,
			failed: backend.state === "error", retry: backend.state === "error", ready } : { ...status, ready }
	})
	ipcMain.handle("desktop:renderer-painted", event => {
		trustedRenderer(event)
		ready = true
	})
	ipcMain.handle("desktop:renderer-startup-status", (event, value) => {
		trustedRenderer(event)
		if (!value || !["starting", "ready", "error"].includes(value.state) || typeof value.message !== "string") {
			throw new Error("Invalid startup status.")
		}
		if (!dismissed) rendererStatus = { state: value.state, message: value.message }
	})
	ipcMain.handle("desktop:finish-splash", event => {
		trustedSplash(event)
		if (!ready || dismissed) return
		dismissed = true
		window.removeListener("resize", resize)
		window.webContents.setZoomLevel(splashContents.getZoomLevel())
		window.contentView.removeChildView(splashView)
		// Reply before disposing the caller's document.
		setImmediate(() => {
			splashContents.close()
			if (!window.isDestroyed() && !controller.signal.aborted) window.webContents.focus()
		})
	})
	ipcMain.handle("desktop:retry-preparation", event => {
		trustedSplash(event)
		if (controller.signal.aborted || dismissed) return
		if (application) {
			if (application.snapshot().state === "error" || rendererStatus?.state === "error") {
				rendererStatus = undefined
				application.retry()
			}
			return
		}
		if (!pending && status.retry && !controller.signal.aborted) {
			status = { message: "Preparing Robozium…", failed: false, retry: false }
			pending = prepare()
		}
	})
	await splashContents.loadFile(splash)
	if (controller.signal.aborted) return
	window.show()
	pending = prepare()
}

async function main() {
	try { await start() }
	catch (error) { console.error("Robozium could not open its window:", error); app.exit(1) }
}

app.on("window-all-closed", () => app.quit())
void main()
