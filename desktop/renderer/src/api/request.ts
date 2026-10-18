// Apply a deadline to any abortable request; the caller owns its lifetime and accepted result.
export const REQUEST_TIMEOUT_MS = 10_000

export class RequestTimeoutError extends Error {
	constructor(message = "Request timed out. Check the backend before trying again.") {
		super(message)
		this.name = "RequestTimeoutError"
	}
}

/** Bound one operation; its caller owns cancellation and stale-response handling. */
export async function withDeadline<T>(
	signal: AbortSignal,
	operation: (signal: AbortSignal) => Promise<T>,
	timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
	signal.throwIfAborted()
	const deadline = new AbortController()
	const requestSignal = AbortSignal.any([signal, deadline.signal])
	const timeout = setTimeout(() => deadline.abort(), timeoutMs)
	try {
		const value = await operation(requestSignal)
		requestSignal.throwIfAborted()
		return value
	} catch (error) {
		signal.throwIfAborted()
		if (deadline.signal.aborted) throw new RequestTimeoutError()
		throw error
	} finally {
		clearTimeout(timeout)
	}
}
