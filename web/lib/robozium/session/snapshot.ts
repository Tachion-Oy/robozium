import { fetchRunView } from "../client"
import type { RunView } from "../wire"
import type { SessionEvent } from "./reducer"

const SNAPSHOT_TIMEOUT_MS = 10_000
const MAX_SNAPSHOT_TIMEOUT_MS = 60_000

export type RunViewLoader = (signal: AbortSignal) => Promise<RunView | null>

/** Fetch and apply snapshots one at a time across polling and stream recovery. */
export function createRunViewLoader(
	runId: string,
	dispatch: (event: SessionEvent) => void,
): RunViewLoader {
	let pending: Promise<RunView> | null = null
	let timeoutMs = SNAPSHOT_TIMEOUT_MS
	return async (signal) => {
		while (pending !== null) {
			try {
				await pending
			} catch {
				continue
			}
		}
		if (signal.aborted) return null
		// A stalled request must release the loader so recovery can proceed.
		const timeoutSignal = AbortSignal.timeout(timeoutMs)
		const requestSignal = AbortSignal.any([signal, timeoutSignal])
		pending = fetchRunView(runId, { signal: requestSignal })
		try {
			const runView = await pending
			if (requestSignal.aborted) return null
			dispatch({ class: "runView", type: "received", runView })
			return runView
		} catch (error) {
			// Give slow endpoints more time on subsequent attempts.
			if (timeoutSignal.aborted) timeoutMs = Math.min(timeoutMs * 2, MAX_SNAPSHOT_TIMEOUT_MS)
			throw error
		} finally {
			pending = null
		}
	}
}
