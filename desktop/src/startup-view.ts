// The startup screen over the application window, as in the experiment's main.cjs:
// at launch, during backend restarts and while the app restarts. It is a second
// document of the renderer bundle in a view of its own, so it paints at once and
// fades only after the application has drawn beneath it.
import { ipcMain, WebContentsView, type BrowserWindow, type Input, type IpcMainInvokeEvent } from "electron"
import type { AppTheme, LauncherStatus } from "./bridge.d.ts"
import { startupUrl } from "./renderer-protocol.ts"
import { lockNavigation } from "./security.ts"

export type StartupMode = "intro" | "loading"

// A screen that never paints is skipped rather than covering the window for good.
const PAINT_TIMEOUT_MS = 10_000
// Removes the screen if its fade never reports an end.
const FADE_FALLBACK_MS = 1000

export class StartupView {
	/** What the screen shows; whoever runs the current step replaces it. */
	status: () => LauncherStatus = () => ({ state: "starting", message: "Starting Robozium…" })
	/** Run again after the failure the screen shows. */
	retry: () => void = () => {}
	/** Keyboard input on the screen, such as zoom shortcuts that the application also handles. */
	onInput: ((input: Input) => boolean) | null = null
	theme: AppTheme
	private readonly window: BrowserWindow
	private readonly preload: string
	private zoom: number
	private view: WebContentsView | null = null
	/** Resolves the show() call of the current view once it has painted. */
	private painting: { view: WebContentsView; resolve: () => void } | null = null
	private screenPainted = false
	/** False while an operation still runs; the application's next ready() may then end the screen. */
	private awaitingApp = false
	private appReady = false
	private handoffTimer: NodeJS.Timeout | undefined

	constructor(window: BrowserWindow, preload: string, settings: { theme: AppTheme; zoom: number }) {
		this.window = window
		this.preload = preload
		this.theme = settings.theme
		this.zoom = settings.zoom
		window.on("resize", () => this.fit())
		this.handle("launcher:status", () => this.status())
		this.handle("launcher:retry", () => this.retry())
		this.handle("launcher:visible", () => { if (!this.window.isVisible()) this.window.show() })
		this.handle("launcher:painted", view => {
			this.screenPainted = true
			if (this.painting?.view === view) this.painting.resolve()
			this.sendReady()
		})
		this.handle("launcher:handoff", () => {
			if (this.appReady && !this.handoffTimer) this.handoffTimer = setTimeout(() => this.remove(), FADE_FALLBACK_MS)
		})
		this.handle("launcher:faded", () => { if (this.handoffTimer) this.remove() })
	}

	/** Cover the window and resolve once the screen has painted; the window shows with it. */
	async show(mode: StartupMode): Promise<void> {
		this.remove()
		this.screenPainted = false
		this.awaitingApp = false
		this.appReady = false
		const view = new WebContentsView({ webPreferences: {
			preload: this.preload, zoomFactor: this.zoom, sandbox: true, contextIsolation: true, nodeIntegration: false,
		} })
		this.view = view
		view.setBackgroundColor("#00000000")
		this.window.contentView.addChildView(view)
		this.fit()
		const contents = view.webContents
		lockNavigation(contents)
		contents.on("before-input-event", (event, input) => { if (this.onInput?.(input)) event.preventDefault() })
		let timer: NodeJS.Timeout | undefined
		try {
			await Promise.all([
				contents.loadURL(`${startupUrl}?theme=${this.theme}&mode=${mode}`),
				new Promise<void>((resolve, reject) => {
					this.painting = { view, resolve }
					timer = setTimeout(() => reject(new Error("The startup screen did not paint.")), PAINT_TIMEOUT_MS)
				}),
			])
			if (this.view === view) contents.focus()
		} catch (error) {
			// A newer screen replacing this one is not a failure.
			if (this.view !== view) return
			console.error("The startup screen could not show:", error)
			this.remove()
			if (!this.window.isDestroyed()) this.window.show()
		} finally {
			clearTimeout(timer)
			if (this.painting?.view === view) this.painting = null
		}
	}

	/** From now on, the application's ready() lets the screen fade. */
	awaitApp(): void {
		this.awaitingApp = true
	}

	/** The application has drawn its HUD, or a failure it handles itself, beneath the screen. */
	appPainted(): void {
		if (!this.view || !this.awaitingApp) return
		this.appReady = true
		this.sendReady()
	}

	setZoom(zoom: number): void {
		this.zoom = zoom
		this.view?.webContents.setZoomFactor(zoom)
	}

	remove(): void {
		clearTimeout(this.handoffTimer)
		this.handoffTimer = undefined
		const view = this.view
		if (!view) return
		this.view = null
		if (!this.window.isDestroyed()) {
			this.window.contentView.removeChildView(view)
			this.window.webContents.focus()
		}
		if (!view.webContents.isDestroyed()) view.webContents.close()
	}

	/** The screen listens for ready only once it has painted, so a ready before that waits. */
	private sendReady(): void {
		if (this.view && this.appReady && this.screenPainted) this.view.webContents.send("launcher:ready")
	}

	/** Only the current screen's document may use these operations; a replaced one is ignored. */
	private handle(channel: string, handler: (view: WebContentsView) => unknown): void {
		ipcMain.handle(channel, (event: IpcMainInvokeEvent) => {
			const view = this.view
			if (!view || event.sender !== view.webContents || event.senderFrame !== view.webContents.mainFrame
				|| !event.senderFrame.url.startsWith(startupUrl)) {
				throw new Error("Unauthorized startup operation.")
			}
			return handler(view)
		})
	}

	private fit(): void {
		if (!this.view || this.window.isDestroyed()) return
		const [width, height] = this.window.getContentSize()
		this.view.setBounds({ x: 0, y: 0, width, height })
	}
}
