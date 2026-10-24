// Converted from robozium-electron/desktop/electron/loading-preload.cjs at 076b2c9.
import { contextBridge, ipcRenderer } from "electron"
import type { LauncherBridge } from "./bridge.d.ts"

const launcher: LauncherBridge = {
	status: () => ipcRenderer.invoke("launcher:status"),
	retry: () => ipcRenderer.invoke("launcher:retry"),
	visible: () => ipcRenderer.invoke("launcher:visible"),
	painted: () => ipcRenderer.invoke("launcher:painted"),
	handoff: () => ipcRenderer.invoke("launcher:handoff"),
	faded: () => ipcRenderer.invoke("launcher:faded"),
	onReady: callback => {
		const listener = () => callback()
		ipcRenderer.on("launcher:ready", listener)
		return () => ipcRenderer.removeListener("launcher:ready", listener)
	},
}
contextBridge.exposeInMainWorld("launcher", launcher)
