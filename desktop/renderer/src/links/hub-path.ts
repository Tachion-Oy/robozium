// Hub-relative paths named by agent output. Main checks containment again before opening one.

export const hasControlCharacter = (value: string): boolean =>
	Array.from(value).some(char => char < " " || char === "\u007f")

/** Join path segments into a hub-relative path, or null when any segment is empty, relative or unsafe. */
export function joinHubPath(segments: readonly string[]): string | null {
	const safe = segments.every(segment =>
		segment && segment !== "." && segment !== ".." && !/[/\\]/.test(segment) && !hasControlCharacter(segment))
	return safe ? segments.join("/") : null
}
