// One run owns one stream and one serialized snapshot reader, including recovery timers.
import { ApiError, type DesktopApiClient } from "../api/client"
import { REQUEST_TIMEOUT_MS, RequestTimeoutError, withDeadline } from "../api/request"
import { isRetryableReadError, RECONNECT_BASE_DELAY_MS, RECONNECT_MAX_DELAY_MS } from "../api/retry"
import { isTerminal } from "./run-contracts"
import { getRunSnapshot, streamRunEvents } from "./run-api"
import type { RunAction } from "./run-reducer"

export function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Run output unavailable." }

// Adapted from web/lib/robozium/session/{connection,poller,snapshot}.ts at 072341b.
// Reads may retry; writes are never part of this connection owner.
export function watchRun(
	client: DesktopApiClient,
	runId: string,
	project: string,
	dispatch: (action: RunAction) => void,
): (() => void) & { refresh: () => void } {
	const controller = new AbortController()
	let snapshotTimer: ReturnType<typeof setTimeout> | undefined
	let streamTimer: ReturnType<typeof setTimeout> | undefined
	let openingTimer: ReturnType<typeof setTimeout> | undefined
	let reading: Promise<void> | null = null
	let queued = false
	let snapshotDelay = RECONNECT_BASE_DELAY_MS
	let streamDelay = RECONNECT_BASE_DELAY_MS
	let streamError: unknown = null
	const disposed = () => controller.signal.aborted
	const dispose = () => {
		controller.abort()
		clearTimeout(snapshotTimer)
		clearTimeout(streamTimer)
		clearTimeout(openingTimer)
	}
	const report = (error: unknown) => {
		if (disposed()) return
		dispatch({ type: "error", message: errorMessage(error), unavailable: error instanceof ApiError && error.status === 404 })
	}
	const fail = (error: unknown) => { report(error); dispose() }

	const read = async () => {
		let delay = 2000
		try {
			do {
				queued = false
				try {
					const view = await withDeadline(controller.signal, signal => getRunSnapshot(client, runId, signal))
					if (disposed()) return
					if (view.project !== project) throw new ApiError("malformed", "The backend returned a different run project.")
					dispatch({ type: "snapshot", view })
					snapshotDelay = RECONNECT_BASE_DELAY_MS
					if (isTerminal(view.status)) { dispose(); return }
					if (streamError !== null) report(streamError)
				} catch (error) {
					if (disposed()) return
					if (!isRetryableReadError(error)) { fail(error); return }
					report(error)
					delay = snapshotDelay
					snapshotDelay = Math.min(snapshotDelay * 2, RECONNECT_MAX_DELAY_MS)
					break
				}
			} while (queued && !disposed())
		} finally {
			reading = null
			if (!disposed()) snapshotTimer = setTimeout(() => { void refresh() }, delay)
		}
	}
	const refresh = (): Promise<void> => {
		if (disposed()) return Promise.resolve()
		queued = true
		clearTimeout(snapshotTimer)
		reading ??= read()
		return reading
	}

	const follow = async () => {
		if (disposed()) return
		const stream = new AbortController()
		let timedOut = false
		let failure: unknown = new ApiError("connection", "Live output disconnected. Reconnecting…")
		openingTimer = setTimeout(() => { timedOut = true; stream.abort() }, REQUEST_TIMEOUT_MS)
		try {
			for await (const frame of streamRunEvents(client, runId, AbortSignal.any([controller.signal, stream.signal]), () => {
				clearTimeout(openingTimer)
				streamError = null
				dispatch({ type: "retry" })
				// Always read after opening, even when an earlier snapshot is still pending.
				void refresh()
			})) {
				if (disposed()) return
				streamDelay = RECONNECT_BASE_DELAY_MS
				dispatch({ type: "frame", frame })
			}
		} catch (error) {
			failure = timedOut ? new RequestTimeoutError("Live output connection timed out. Reconnecting…") : error
		} finally {
			clearTimeout(openingTimer)
			stream.abort()
		}
		if (disposed()) return
		// A terminal stream returns 409; only a fresh snapshot establishes its outcome.
		if (!isRetryableReadError(failure) && !(failure instanceof ApiError && failure.status === 409)) { fail(failure); return }
		streamError = failure
		report(failure)
		await refresh()
		if (disposed()) return
		streamTimer = setTimeout(() => { void follow() }, streamDelay)
		streamDelay = Math.min(streamDelay * 2, RECONNECT_MAX_DELAY_MS)
	}

	void refresh()
	void follow()
	return Object.assign(dispose, { refresh: () => { void refresh() } })
}
