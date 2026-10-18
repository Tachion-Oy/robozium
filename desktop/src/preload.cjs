const { contextBridge, ipcRenderer } = require("electron")

// Sandboxed preload can import Electron, but cannot require sibling modules.
/** @type {import("./bridge").DesktopBridge} */
const bridge = {
	getBackendConnection: () => ipcRenderer.invoke("desktop:backend-connection"),
	getBackendStatus: () => ipcRenderer.invoke("desktop:backend-status"),
	retryBackend: () => ipcRenderer.invoke("desktop:retry-backend"),
	getVersion: () => ipcRenderer.invoke("desktop:version"),
	writeClipboardText: text => ipcRenderer.invoke("desktop:write-clipboard-text", text),
}
contextBridge.exposeInMainWorld("robozium", bridge)
/** @type {import("./bridge").PreparationBridge} */
const preparation = {
	status: () => ipcRenderer.invoke("desktop:preparation-status"),
	retry: () => ipcRenderer.invoke("desktop:retry-preparation"),
	painted: () => ipcRenderer.invoke("desktop:renderer-painted"),
	report: status => ipcRenderer.invoke("desktop:renderer-startup-status", status),
	finished: () => ipcRenderer.invoke("desktop:finish-splash"),
}
contextBridge.exposeInMainWorld("roboziumStartup", preparation)
