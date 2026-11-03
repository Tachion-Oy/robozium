// Converted from robozium-electron/desktop/electron/security.cjs at 076b2c9.
// Adapted: only the permission rules, keyed to the bundled document's URL like
// main's IPC check. Clipboard writes go through IPC, so only two permissions are
// granted: microphone audio for the main frame, and reading a folder the user dropped.
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

/**
 * Reading a folder the user dropped on the window. Electron checks each read of a
 * dropped folder with no frame, so the check carries only the page's origin and a
 * readable access; writing stays refused.
 */
export function droppedFolderReadAllowed(
	documentUrl: string, permission: string, requestingOrigin: string, details: { fileAccessType?: string },
): boolean {
	if (permission !== "fileSystem" || details.fileAccessType !== "readable") return false
	try {
		const requester = new URL(requestingOrigin), document = new URL(documentUrl)
		return requester.protocol === document.protocol && requester.host === document.host
	} catch {
		return false
	}
}
