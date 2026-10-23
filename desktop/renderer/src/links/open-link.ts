// Open agent links through the desktop bridge; main validates every target.
import { showErrorToast } from "../feedback/notices"

async function report(open: () => Promise<void>) {
	try {
		await open()
	} catch (error) {
		// Electron prefixes IPC rejections; keep only main's own message.
		const detail = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, "") : null
		showErrorToast({ title: "Could not open link", message: "The link could not be opened.", detail })
	}
}

/** Open an http(s) link in the default browser. */
export function openExternalLink(url: string): void {
	void report(() => window.robozium.openExternal(url))
}

/** Open a hub-relative file or folder with its default application. */
export function openHubFile(path: string): void {
	void report(() => window.robozium.openHubFile(path))
}
