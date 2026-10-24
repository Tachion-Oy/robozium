// Copied from web/lib/robozium/hud-images.ts at 2a0c183.
// Adapted: a hub image keeps its hub-relative path, which the backend serves
// and main opens; there is no app-relative proxy.

export type HudImageSource = { kind: "web"; url: string } | { kind: "hub"; path: string }

const hasControlCharacter = (value: string) => Array.from(value).some(char => char < " " || char === "\u007f")

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

	try {
		// Markdown encodes spaces and Unicode before invoking urlTransform.
		const segments = value.split("/").map((segment) => decodeURIComponent(segment))
		if (segments.some((segment) =>
			!segment || segment === "." || segment === ".." || /[/\\]/.test(segment) || hasControlCharacter(segment),
		)) return null
		return { kind: "hub", path: segments.join("/") }
	} catch {
		return null
	}
}
