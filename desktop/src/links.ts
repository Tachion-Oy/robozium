// Validate link targets from the renderer before the shell opens them.
// Main owns the hub directory; the renderer only names a hub-relative path.
import { realpath } from "node:fs/promises"
import path from "node:path"

/** Only web pages leave the app; any other scheme could run a local handler. */
export function externalUrl(value: unknown): string {
	if (typeof value !== "string") throw new TypeError("A link must be a URL.")
	let url: URL
	try {
		url = new URL(value)
	} catch {
		throw new TypeError("A link must be a URL.")
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError("Only http and https links open.")
	return url.href
}

/**
 * Resolve a hub-relative path to an existing file or folder inside the hub.
 * Both sides are real paths, so a symlink cannot lead outside.
 */
export async function hubFilePath(hub: string, value: unknown): Promise<string> {
	if (typeof value !== "string") throw new TypeError("A hub file must be a path.")
	const segments = value.split("/")
	if (!value || segments.some(segment => !segment || segment === "." || segment === ".." || segment.includes("\\"))) {
		throw new TypeError("A hub file must be a relative path inside the hub.")
	}
	const root = await realpath(hub)
	let target: string
	try {
		target = await realpath(path.join(root, ...segments))
	} catch {
		throw new Error("The file does not exist.")
	}
	const relative = path.relative(root, target)
	if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
		throw new Error("The file is outside the hub.")
	}
	return target
}
