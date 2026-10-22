import { contextBridge, ipcRenderer } from "electron"
import type { AppTheme, DesktopBridge } from "./bridge"

// Sandboxed preload can import Electron, but cannot require sibling modules.
// Main passes the saved theme as an argument; a synchronous value avoids a first paint in dark.
const theme: AppTheme = process.argv.includes("--robozium-theme=light") ? "light" : "dark"
const bridge: DesktopBridge = {
	theme,
	setTheme: theme => ipcRenderer.invoke("desktop:set-theme", theme),
	getBackendConnection: () => ipcRenderer.invoke("desktop:backend-connection"),
	getBackendStatus: () => ipcRenderer.invoke("desktop:backend-status"),
	retryBackend: () => ipcRenderer.invoke("desktop:retry-backend"),
	restartBackend: () => ipcRenderer.invoke("desktop:restart-backend"),
	recreateBackend: () => ipcRenderer.invoke("desktop:recreate-backend"),
	restartApp: () => ipcRenderer.invoke("desktop:relaunch"),
	getVersion: () => ipcRenderer.invoke("desktop:version"),
	writeClipboardText: text => ipcRenderer.invoke("desktop:write-clipboard-text", text),
}
contextBridge.exposeInMainWorld("robozium", bridge)
