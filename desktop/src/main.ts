import { app, type BrowserWindow, clipboard, ipcMain, type IpcMainInvokeEvent } from "electron"
import path from "node:path"
import { BackendController } from "./backend-controller"
import { registerRendererProtocol, rendererUrl } from "./renderer-protocol"
import type { BackendStatus } from "./bridge"

interface ApplicationOptions {
	profile: string
	preview: boolean
	signal: AbortSignal
	onShutdown: (close: () => Promise<void>) => void
}

export async function start(window: BrowserWindow, { profile, preview, signal, onShutdown }: ApplicationOptions): Promise<{
	snapshot: () => BackendStatus
	retry: () => void
}> {
	const backend = preview ? undefined : new BackendController({
		profile, mode: process.argv.includes("--mock") ? "mock" : "live", port: process.env.ROBOZIUM_DESKTOP_API_PORT,
		source: path.join(__dirname, "../.stage/backend"), compose: path.join(__dirname, "../compose.yaml"),
	})
	onShutdown(async () => { await backend?.close() })
	await registerRendererProtocol(backend?.connection().baseUrl)
	signal.throwIfAborted()
	const startBackend = async () => {
		try {
			await backend?.start()
		} catch {
			// The controller exposes startup failures through its status for the UI.
		}
	}
	const contents = window.webContents

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
	ipcMain.handle("desktop:version", event => {
		requireTrustedDocument(event)
		return app.getVersion()
	})
	ipcMain.handle("desktop:write-clipboard-text", (event, text: unknown) => {
		requireTrustedDocument(event)
		if (typeof text !== "string") throw new TypeError("Clipboard text must be a string.")
		clipboard.writeText(text)
	})
	await window.loadURL(rendererUrl)
	signal.throwIfAborted()
	void startBackend()
	return {
		snapshot: () => backend?.snapshot() ?? { state: "ready", message: "Local preview" },
		retry: () => {
			if (backend?.snapshot().state !== "ready") void startBackend()
			// Only the initial splash can call this: remount startup checks after retry.
			window.webContents.reload()
		},
	}
}
