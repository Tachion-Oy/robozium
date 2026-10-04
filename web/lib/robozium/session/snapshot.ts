import { fetchRunView } from "../client"
import type { RunView } from "../wire"
import type { SessionEvent } from "./reducer"

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
		pending = fetchRunView(runId, { signal })
		try {
			const runView = await pending
			if (signal.aborted) return null
			dispatch({ class: "runView", type: "received", runView })
			return runView
		} finally {
			pending = null
		}
	}
}
