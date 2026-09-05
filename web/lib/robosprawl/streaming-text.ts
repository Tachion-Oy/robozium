/**
 * Cosmetic cleanup for the live LLM token stream shown in the HUD while the
 * agent is generating.
 *
 * The raw stream is the model's token output, which for agent messages is
 * partial JSON (e.g. `{"action": "writing file", "rationale": "the user`).
 * Showing that verbatim looks nasty, but we must NOT wait for the JSON to become
 * parseable — that would stall until the whole message arrives and kill the
 * smooth streaming effect.
 *
 * So this only applies cheap, character-level transforms to the *entire*
 * accumulated string on every call. It is idempotent and stateless: there is no
 * cross-call buffering and nothing ever waits for a bracket/quote to close, so
 * the stream stays smooth. Keep the transforms minimal — they are deliberately
 * "under-done" and meant to be tuned later.
 */
export function streamingDisplayText(raw: string): string {
	return (
		raw
			// Render escaped whitespace as real whitespace.
			.replace(/\\n/g, "\n")
			.replace(/\\t/g, "\t")
			// Unescape `\"` / `\\` before stripping quotes, so no stray slashes linger.
			.replace(/\\(["\\])/g, "$1")
			// Drop the JSON structural punctuation that reads badly mid-stream.
			.replace(/[{}"]/g, "")
			// Trim a leading orphaned comma/space left after dropping the opening brace.
			.replace(/^[\s,]+/, "")
	)
}
