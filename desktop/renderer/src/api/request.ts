// Apply a deadline to any abortable request; the caller owns its lifetime and accepted result.
export const REQUEST_TIMEOUT_MS = 10_000

/**
 * Bound one operation; its caller owns cancellation and stale-response handling.
 * The operation's signal ends when it settles, so parallel work it started (such
 * as the other half of a failed Promise.all) cannot outlive it.
 */
export async function withDeadline<T>(
	signal: AbortSignal,
	operation: (signal: AbortSignal) => Promise<T>,
	timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
	signal.throwIfAborted()
	const deadline = new AbortController()
	const settled = new AbortController()
	const requestSignal = AbortSignal.any([signal, deadline.signal, settled.signal])
	const timeout = setTimeout(() => deadline.abort(), timeoutMs)
	try {
		const value = await operation(requestSignal)
		requestSignal.throwIfAborted()
		return value
	} catch (error) {
		signal.throwIfAborted()
		if (deadline.signal.aborted) throw new Error("Request timed out. Check the backend before trying again.")
		throw error
	} finally {
		clearTimeout(timeout)
		settled.abort(new DOMException("The request settled.", "AbortError"))
	}
}
