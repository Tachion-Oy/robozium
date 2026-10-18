// Watch one run through concurrent SSE and serialized snapshot polling.
// Own request cleanup and final-state confirmation; dispatch data without shaping HUD output.
import { ApiError, type DesktopApiClient } from "../api/client"
import { withDeadline } from "../api/request"
import { isTerminal, type RunFrame, type RunView } from "./run-contracts"
import { getRunSnapshot, streamRunEvents } from "./run-api"
import type { RunAction } from "./run-reducer"

const RUN_POLL_INTERVAL_MS = 2000
type RunSnapshotLoader = () => Promise<RunView | null>

export function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Run output unavailable." }

// Adapted from web/lib/robozium/session/{connection,poller,snapshot}.ts at 673d361.
// SSE supplies live output; snapshots recover history, status and prompts independently.
export function watchRun(
	client: DesktopApiClient,
	runId: string,
	project: string,
	dispatch: (action: RunAction) => void,
): (() => void) & { refresh: () => void } {
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
		let failure: unknown = new Error("Live output disconnected. Retry output to reconnect.")
		try {
			await consumeRunStream(client, runId, controller.signal, frame => dispatch({ type: "frame", frame }))
		} catch (error) {
			failure = error
		}
		if (controller.signal.aborted) return
		polling.stop()
		try {
			// Closure or HTTP 409 needs a fresh read after any already in-flight snapshot.
			await loadSnapshot()
			if (!controller.signal.aborted) fail(failure)
		} catch (error) {
			fail(error)
		}
	}

	// Both tasks run concurrently; the stream promise is intentionally not awaited here.
	void followStream()
	polling.start(loadSnapshot, fail)
	return Object.assign(dispose, { refresh: () => { void refresh() } })

	async function refresh() {
		try { await loadSnapshot() } catch (error) { fail(error) }
	}
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
		while (pending) await pending
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
				if (!stopped) onError(error)
				return
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
