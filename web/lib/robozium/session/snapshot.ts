import { fetchRunView } from "../client"
import type { RunView } from "../wire"
import type { SessionEvent } from "./reducer"

const SNAPSHOT_TIMEOUT_MS = 10_000

export type RunViewLoader = (signal: AbortSignal) => Promise<RunView | null>

/** Fetch and apply snapshots one at a time across polling and stream recovery. */
export function createRunViewLoader(
	runId: string,
	dispatch: (event: SessionEvent) => void,
): RunViewLoader {
	let pending: Promise<RunView> | null = null
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
		const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS)])
		pending = fetchRunView(runId, { signal: requestSignal })
		try {
			const runView = await pending
			if (requestSignal.aborted) return null
			dispatch({ class: "runView", type: "received", runView })
			return runView
		} finally {
			pending = null
		}
	}
}
