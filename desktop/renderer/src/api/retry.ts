// Shared policy for automatic recovery of reads. Writes never use it.
import { ApiError } from "./client"
import { RequestTimeoutError } from "./request"

/** A read may succeed if tried again: a timeout, a lost connection or a transient HTTP status. */
export function isRetryableReadError(error: unknown): boolean {
	if (error instanceof RequestTimeoutError) return true
	if (!(error instanceof ApiError)) return false
	if (error.kind === "connection") return true
	return error.kind === "http" && error.status !== undefined
		&& ([408, 425, 429, 499].includes(error.status) || error.status >= 500)
}
