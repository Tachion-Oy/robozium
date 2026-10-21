/** Resolve authored image sources without allowing arbitrary app-relative requests. */
export function resolveHudImageUrl(source: string): string | null {
	const value = source.trim()
	if (!value || /[\u0000-\u001f\u007f\\]/.test(value)) return null

	if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
		if (!/^https?:\/\//i.test(value)) return null
		try {
			const url = new URL(value)
			return url.hostname && !url.username && !url.password ? url.href : null
		} catch {
			return null
		}
	}

	try {
		// Markdown encodes spaces and Unicode before invoking urlTransform.
		const segments = value.split("/").map((segment) => decodeURIComponent(segment))
		if (segments.some((segment) =>
			!segment || segment === "." || segment === ".." || /[/\\\u0000-\u001f\u007f]/.test(segment),
		)) return null
		return `/api/files/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`
	} catch {
		return null
	}
}
