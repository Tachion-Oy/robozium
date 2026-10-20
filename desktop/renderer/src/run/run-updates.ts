// Watch one run through concurrent SSE and serialized snapshot polling.
// Own request cleanup, reconnection and final-state confirmation; dispatch data without shaping HUD output.
import { ApiError, type DesktopApiClient } from "../api/client"
import { withDeadline } from "../api/request"
import { isRetryableReadError } from "../api/retry"
import { isTerminal, type RunFrame, type RunView } from "./run-contracts"
import { getRunSnapshot, streamRunEvents } from "./run-api"
import type { RunAction } from "./run-reducer"

const RUN_POLL_INTERVAL_MS = 2000
const RECONNECT_BASE_DELAY_MS = 500
const RECONNECT_MAX_DELAY_MS = 4000

/** 0.5, 1 and 2 seconds, then 4 seconds after every further failure in a row. */
export function reconnectDelay(failures: number): number {
	return Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** failures)
}
type RunSnapshotLoader = () => Promise<RunView | null>

export function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Run output unavailable." }

// Adapted from web/lib/robozium/session/{connection,poller,snapshot}.ts at 673d361.
// SSE supplies live output; snapshots recover history, status and prompts independently.
// As in the reference, transient failures reconnect quietly; only a failure that
// trying again cannot fix is reported, and it ends the watch.
export function watchRun(
	client: DesktopApiClient,
	runId: string,
	project: string,
	dispatch: (action: RunAction) => void,
): () => void {
	const controller = new AbortController()
	const polling = createRunPoller()

	const dispose = () => {
		controller.abort()
		polling.stop()
	}

	const fail = (error: unknown) => {
		if (controller.signal.aborted) return
		dispatch({
			type: "error",
			message: errorMessage(error),
			unavailable: error instanceof ApiError && error.status === 404,
		})
		dispose()
	}

	const loadSnapshot = createRunSnapshotLoader(client, runId, project, controller.signal, view => {
		dispatch({ type: "snapshot", view })
		if (isTerminal(view.status)) dispose()
	})

	const followStream = async () => {
		let failures = 0
		while (!controller.signal.aborted) {
			try {
				await consumeRunStream(client, runId, controller.signal, frame => {
					failures = 0
					dispatch({ type: "frame", frame })
				})
			} catch (error) {
				if (controller.signal.aborted) return
				// A finished run refuses its stream with 409; the snapshot below settles it.
				if (!isRetryableReadError(error) && !(error instanceof ApiError && error.status === 409)) return fail(error)
			}
			try {
				// A fresh read after any in-flight one recovers the gap, and a terminal view ends the watch.
				await loadSnapshot()
			} catch (error) {
				if (!isRetryableReadError(error)) return fail(error)
			}
			await abortableDelay(reconnectDelay(failures++), controller.signal)
		}
	}

	// Both tasks run concurrently; the stream promise is intentionally not awaited here.
	void followStream()
	polling.start(loadSnapshot, fail)
	return dispose
}

/** Serialize reads; each caller gets a fresh snapshot after any earlier read settles. */
function createRunSnapshotLoader(
	client: DesktopApiClient,
	runId: string,
	project: string,
	signal: AbortSignal,
	onSnapshot: (view: RunView) => void,
): RunSnapshotLoader {
	let pending: Promise<RunView> | null = null
	return async () => {
		while (pending) {
			try {
				await pending
			} catch {
				// The earlier caller handles its own failure; this caller still reads afresh.
			}
		}
		if (signal.aborted) return null
		pending = withDeadline(signal, requestSignal => getRunSnapshot(client, runId, requestSignal))
		try {
			const view = await pending
			if (signal.aborted) return null
			if (view.project !== project) throw new ApiError("malformed", "The backend returned a different run project.")
			// Deliver before releasing the next reader, so a terminal view can dispose the connection.
			onSnapshot(view)
			return view
		} finally {
			pending = null
		}
	}
}

/** Create an idle poller with cleanup available before start. The connection owns in-flight reads. */
function createRunPoller() {
	let stopped = false
	let timer: ReturnType<typeof setTimeout> | undefined

	const stop = () => {
		stopped = true
		clearTimeout(timer)
	}

	const start = (loadSnapshot: RunSnapshotLoader, onError: (error: unknown) => void) => {
		const poll = async () => {
			if (stopped) return
			try {
				await loadSnapshot()
			} catch (error) {
				if (stopped) return
				if (!isRetryableReadError(error)) return onError(error)
			}
			if (!stopped) timer = setTimeout(() => { void poll() }, RUN_POLL_INTERVAL_MS)
		}
		void poll()
	}

	return { start, stop }
}

/** Consume one SSE subscription; the connection owns closure handling and cancellation. */
async function consumeRunStream(
	client: DesktopApiClient,
	runId: string,
	signal: AbortSignal,
	onFrame: (frame: RunFrame) => void,
): Promise<void> {
	for await (const frame of streamRunEvents(client, runId, signal)) {
		if (signal.aborted) return
		onFrame(frame)
	}
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
	return new Promise(resolve => {
		if (signal.aborted) return resolve()
		const finish = () => {
			clearTimeout(timer)
			signal.removeEventListener("abort", finish)
			resolve()
		}
		const timer = setTimeout(finish, delayMs)
		signal.addEventListener("abort", finish, { once: true })
	})
}
