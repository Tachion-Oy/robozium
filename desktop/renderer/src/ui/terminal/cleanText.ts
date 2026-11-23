/** Plain-text cleanup for log rows: angle brackets as tags, bounded length. */

const MAX_CONTENT_CHARS = 500
const ANGLE_BRACKET_LEFT = "["
const ANGLE_BRACKET_RIGHT = "]"

function substituteAngleBrackets(s: string): string {
	return s.replace(
		/<([^>\n]+)>/g,
		(_, inner: string) =>
			`${ANGLE_BRACKET_LEFT}${inner}${ANGLE_BRACKET_RIGHT}`,
	)
}

export function cleanText(
	s: string,
	limit: number = MAX_CONTENT_CHARS,
): string {
	const substituted = substituteAngleBrackets(s)
	if (substituted.length <= limit) return substituted
	const cap = Math.max(1, limit - 1)
	return `${substituted.slice(0, cap)}…`
}

/**
 * Like `cleanText`, but keeps the end: script output grows line by line, so the
 * newest lines matter most. The kept text starts at a whole line when one fits.
 */
export function cleanTailText(s: string, limit: number): string {
	const substituted = substituteAngleBrackets(s).replace(/\n+$/, "")
	if (substituted.length <= limit) return substituted
	const tail = substituted.slice(-Math.max(1, limit - 1))
	const lineStart = tail.indexOf("\n")
	return `…${lineStart >= 0 && lineStart < tail.length - 1 ? tail.slice(lineStart) : tail}`
}
