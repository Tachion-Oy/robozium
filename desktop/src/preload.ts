import { contextBridge, ipcRenderer } from "electron"
import type { DesktopBridge } from "./bridge"

// Sandboxed preload can import Electron, but cannot require sibling modules.
const bridge: DesktopBridge = {
	getVersion: () => ipcRenderer.invoke("desktop:version"),
	writeClipboardText: text => ipcRenderer.invoke("desktop:write-clipboard-text", text),
}
contextBridge.exposeInMainWorld("robozium", bridge)
