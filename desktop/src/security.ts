// Converted from robozium-electron/desktop/electron/security.cjs at 076b2c9.
// Adapted: only the permission rules, keyed to the bundled document's URL like
// main's IPC check. Clipboard writes go through IPC, so microphone audio for
// the main frame is the only permission ever granted.
import type { BrowserWindow, WebContents } from "electron"

interface PermissionDetails {
	isMainFrame?: boolean
	requestingUrl?: string
	mediaType?: string
}

export function permissionAllowed(
	window: BrowserWindow, webContents: WebContents | null, documentUrl: string, permission: string, details: PermissionDetails,
): boolean {
	if (window.isDestroyed() || webContents !== window.webContents || !details.isMainFrame) return false
	if (details.requestingUrl !== documentUrl) return false
	return permission === "media" && details.mediaType === "audio"
}

export function permissionRequestAllowed(
	window: BrowserWindow, webContents: WebContents, documentUrl: string, permission: string,
	details: PermissionDetails & { mediaTypes?: string[] },
): boolean {
	const mediaTypes = details.mediaTypes
	const mediaType = mediaTypes?.length && mediaTypes.every(type => type === "audio") ? "audio" : "unknown"
	return permissionAllowed(window, webContents, documentUrl, permission, { ...details, mediaType })
}

/** A document that never navigates, opens popups or attaches webviews; main opens links outside it. */
export function lockNavigation(contents: WebContents): void {
	contents.setWindowOpenHandler(() => ({ action: "deny" }))
	contents.on("will-navigate", event => event.preventDefault())
	contents.on("will-frame-navigate", event => event.preventDefault())
	contents.on("will-redirect", event => event.preventDefault())
	contents.on("will-attach-webview", event => event.preventDefault())
}
