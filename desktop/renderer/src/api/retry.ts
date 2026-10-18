// Shared policy for automatic recovery of reads. Mutating requests never use it.
import { ApiError } from "./client"
import { RequestTimeoutError } from "./request"

export const RECONNECT_BASE_DELAY_MS = 500
export const RECONNECT_MAX_DELAY_MS = 4000

export function isRetryableReadError(error: unknown): boolean {
	if (error instanceof RequestTimeoutError) return true
	if (!(error instanceof ApiError)) return false
	if (error.kind === "connection") return true
	return error.kind === "http" && error.status !== undefined
		&& ([408, 425, 429, 499].includes(error.status) || error.status >= 500)
}
