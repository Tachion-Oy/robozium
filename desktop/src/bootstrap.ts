// The entry point. It opens the window before anything slow runs. A development
// launch (`--prepare`) runs uncompiled through Electron's type stripping and builds
// the app behind a splash in that window; then the compiled app loads into it.
import { app, BrowserWindow, dialog, nativeTheme, protocol, screen } from "electron"
import { mkdirSync } from "node:fs"
import { readFile } from "node:fs/promises"
import nodeModule from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { locations } from "./backend-layout.ts"
import { desktopLocations } from "./locations.ts"
import { prepareDesktop } from "./preparation.ts"
import { rendererUrl } from "./renderer-protocol.ts"
import { permissionAllowed, permissionRequestAllowed } from "./security.ts"
import { readSettings, themeBackground } from "./settings.ts"
import { boundedSize, DEFAULT_SIZE, windowLimits } from "./window.ts"

// Electron's Node 24 has it; the installed Node typings predate it.
const { stripTypeScriptTypes } = nodeModule as typeof nodeModule & { stripTypeScriptTypes: (code: string) => string }
const splashUrl = "robozium-startup://splash/index.html"
protocol.registerSchemesAsPrivileged([
	{ scheme: "robozium", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
	{ scheme: "robozium-startup", privileges: { standard: true, secure: true, supportFetchAPI: true } },
])
app.setName("Robozium")
const root = path.resolve(import.meta.dirname, "..")
const prepare = process.argv.includes("--prepare")
const preview = process.argv.includes("--preview")
const mode = process.argv.includes("--mock") ? "mock" : "live"
// Locations are relative to the compiled main process, wherever this entry runs from.
const compiledMain = path.resolve(import.meta.dirname, locations.compiledMain)
const desktop = desktopLocations({
	packaged: app.isPackaged, appDirectory: path.dirname(compiledMain), resourcesPath: process.resourcesPath,
	userData: app.getPath("userData"), home: app.getPath("home"), mode, preview,
	profileOverride: process.env.ROBOZIUM_DESKTOP_TEST_DATA,
})

/** Serve the splash from the checkout; its script is stripped of types as it is served. */
function registerSplashProtocol(state: () => { step: string; failure: string | null }, retry: () => void): void {
	const splash = path.resolve(import.meta.dirname, locations.splash)
	const branding = path.resolve(import.meta.dirname, locations.splashBranding)
	const files: Record<string, [string, string]> = {
		"/index.html": [path.join(splash, "index.html"), "text/html"],
		"/splash.css": [path.join(splash, "splash.css"), "text/css"],
		"/splash.js": [path.join(splash, "splash.ts"), "text/javascript"],
		"/robozium.svg": [path.join(branding, "robozium.svg"), "image/svg+xml"],
		"/loading.svg": [path.join(branding, "loading.svg"), "image/svg+xml"],
	}
	const csp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
	protocol.handle("robozium-startup", async request => {
		const url = new URL(request.url)
		if (url.host !== "splash") return new Response("Not found", { status: 404 })
		if (url.pathname === "/retry" && request.method === "POST") { retry(); return new Response(null, { status: 204 }) }
		if (request.method !== "GET") return new Response("Method not allowed", { status: 405 })
		if (url.pathname === "/status") return Response.json(state(), { headers: { "Cache-Control": "no-store" } })
		const file = files[url.pathname]
		if (!file) return new Response("Not found", { status: 404 })
		const text = await readFile(file[0], "utf8")
		return new Response(file[1] === "text/javascript" ? stripTypeScriptTypes(text) : text,
			{ headers: { "Content-Type": `${file[1]}; charset=utf-8`, "Content-Security-Policy": csp } })
	})
}

async function open(): Promise<void> {
	const { profile } = desktop
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
			preload: desktop.preload,
			additionalArguments: [`--robozium-theme=${theme}`],
			zoomFactor: settings.zoom,
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
		},
	})
	// GNOME's frame metrics settle when its native title bar is first shown.
	window.once("show", () => window.setContentSize(size.width, size.height))
	window.setMinimumSize(640, 420)
	window.setMenuBarVisibility(false)
	const contents = window.webContents
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

	if (prepare) {
		const controller = new AbortController()
		// Closing during preparation stops it and exits; the app installs its own handler later.
		const close = (event: Electron.Event) => { event.preventDefault(); controller.abort(); app.exit(0) }
		window.on("close", close)
		let state = { step: "Starting Robozium…", failure: null as string | null }
		let running = false
		await new Promise<void>(resolve => {
			const run = async () => {
				running = true
				try {
					await prepareDesktop(root, !preview, controller.signal, step => { state = { step, failure: null } })
					state = { step: "Opening Robozium…", failure: null }
					resolve()
				} catch (error) {
					if (controller.signal.aborted) return
					console.error("Robozium could not prepare:", error)
					state = { ...state, failure: error instanceof Error ? error.message : String(error) }
				} finally { running = false }
			}
			// Retry runs the preparation again after a failure.
			registerSplashProtocol(() => state, () => { if (state.failure && !running) void run() })
			void (async () => {
				try { await contents.loadURL(splashUrl) } catch (error) { console.error("The splash could not load:", error) }
				window.show()
				await run()
			})()
		})
		if (controller.signal.aborted) return
		window.removeListener("close", close)
	}
	const { start } = await import(pathToFileURL(compiledMain).href) as typeof import("./main.ts")
	await start(window, { locations: desktop, mode, preview, settings, size })
}

async function main(): Promise<void> {
	try {
		await open()
	} catch (error) {
		console.error("Robozium could not start:", error)
		// Without a window the failure would otherwise be visible only in a terminal.
		dialog.showErrorBox("Robozium could not start", error instanceof Error ? error.message : String(error))
		app.exit(1)
	}
}

app.on("window-all-closed", () => app.quit())
void main()
