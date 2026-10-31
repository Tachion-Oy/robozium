// A hub image keeps its hub-relative path, which the backend serves
// and main opens; there is no app-relative proxy. Hub path rules are shared
// with file links.
import { hasControlCharacter, joinHubPath } from "./hub-path"

export type HudImageSource = { kind: "web"; url: string } | { kind: "hub"; path: string }

// Markdown encodes spaces and Unicode before invoking urlTransform; raw HTML may carry a literal "%".
function decodeSegment(segment: string): string {
	try {
		return decodeURIComponent(segment)
	} catch {
		return segment
	}
}

/** Resolve authored image sources without allowing arbitrary app-relative requests. */
export function resolveHudImageSource(source: string): HudImageSource | null {
	const value = source.trim()
	if (!value || value.includes("\\") || hasControlCharacter(value)) return null

	if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
		if (!/^https?:\/\//i.test(value)) return null
		try {
			const url = new URL(value)
			return url.hostname && !url.username && !url.password ? { kind: "web", url: url.href } : null
		} catch {
			return null
		}
	}

	const path = joinHubPath(value.split("/").map(decodeSegment))
	return path === null ? null : { kind: "hub", path }
}
