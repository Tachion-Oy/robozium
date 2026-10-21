import { contextBridge, ipcRenderer } from "electron"
import type { DesktopBridge } from "./bridge"

// Sandboxed preload can import Electron, but cannot require sibling modules.
const bridge: DesktopBridge = {
	getBackendConnection: () => ipcRenderer.invoke("desktop:backend-connection"),
	getBackendStatus: () => ipcRenderer.invoke("desktop:backend-status"),
	retryBackend: () => ipcRenderer.invoke("desktop:retry-backend"),
	restartApp: () => ipcRenderer.invoke("desktop:relaunch"),
	getVersion: () => ipcRenderer.invoke("desktop:version"),
	writeClipboardText: text => ipcRenderer.invoke("desktop:write-clipboard-text", text),
}
contextBridge.exposeInMainWorld("robozium", bridge)
