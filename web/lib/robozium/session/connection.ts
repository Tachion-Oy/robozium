import { slog, swarn } from "../log"
import { parsePipeEventStream } from "../sse"
import { getFrameSequence } from "../stream"
import {
	PipeEventType,
	RunLifecycleKind,
	type PipeEventFrame,
	type RunStatus,
	type RunView,
} from "../wire"
import type { SessionEvent } from "./reducer"
import type { RunViewLoader } from "./snapshot"

type Dispatch = (event: SessionEvent) => void

const RECONNECT_BASE_DELAY_MS = 500
const RECONNECT_MAX_DELAY_MS = 4000
const TERMINAL_STATUSES = new Set<RunStatus>([
	"completed",
	"failed",
	"cancelled",
])

async function openRunEventStream(runId: string, signal: AbortSignal) {
	return fetch(`/api/runs/${encodeURIComponent(runId)}/stream`, {
		method: "GET",
		headers: { Accept: "text/event-stream" },
		cache: "no-store",
		signal,
	})
}

async function readRunEventStreamError(response: Response): Promise<string> {
	let detail = ""
	try {
		detail = await response.text()
	} catch {
		// Preserve the status fallback if the error body cannot be read.
	}
	return detail || `stream request failed (${response.status})`
}

function isRetryableStreamStatus(status: number): boolean {
	return (
		status === 408 ||
		status === 425 ||
		status === 429 ||
		status === 499 ||
		status >= 500
	)
}

function isRootTerminalFrame(frame: PipeEventFrame): boolean {
	return (
		frame.type === PipeEventType.RunLifecycle &&
		frame.payload.kind === RunLifecycleKind.Stopped &&
		frame.payload.parent_agent_name == null
	)
}

function isTerminalRunView(runView: RunView): boolean {
	return TERMINAL_STATUSES.has(runView.status)
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.resolve()
	return new Promise((resolve) => {
		const timer = window.setTimeout(finish, delayMs)
		function finish() {
			window.clearTimeout(timer)
			signal.removeEventListener("abort", finish)
			resolve()
		}
		signal.addEventListener("abort", finish, { once: true })
	})
}

export function startRunSessionConnection(
	runId: string,
	dispatch: Dispatch,
	loadRunView: RunViewLoader,
) {
	const connection = new RunSessionConnection(runId, dispatch, loadRunView)
	connection.start()
	return () => connection.dispose()
}

class RunSessionConnection {
	private readonly controller = new AbortController()
	private active = true
	private lastSequence = 0
	private consecutiveFailures = 0

	constructor(
		private readonly runId: string,
		private readonly dispatch: Dispatch,
		private readonly loadRunView: RunViewLoader,
	) {}

	start() {
		void this.run()
	}

	dispose() {
		this.active = false
		this.controller.abort()
	}

	private get stopped() {
		return !this.active || this.controller.signal.aborted
	}

	private async run() {
		while (!this.stopped) {
			try {
				await this.connectOnce()
				return
			} catch (error) {
				if (this.stopped) return
				await this.waitBeforeReconnect(error)
			}
		}
	}

	private async connectOnce(): Promise<void> {
		const response = await openRunEventStream(
			this.runId,
			this.controller.signal,
		)
		if (this.stopped) return

		if (!response.ok || response.body === null) {
			await this.handleOpenFailure(response)
			return
		}

		const runView = await this.snapshotWithOpenStream(response.body)
		if (runView && isTerminalRunView(runView)) {
			await cancelStream(response.body)
			return
		}

		await this.consumeStream(response.body)
	}

	private async handleOpenFailure(response: Response): Promise<void> {
		const message = await readRunEventStreamError(response)
		if (response.status === 409) {
			const runView = await this.synchronizeSnapshot()
			if (runView && isTerminalRunView(runView)) return
			throw new Error(message)
		}
		if (isRetryableStreamStatus(response.status)) throw new Error(message)

		swarn(
			"stream",
			`session stream open failed runId=${this.runId} status=${response.status}: ${message}`,
		)
		this.dispatch({ class: "stream", type: "open_failed", message })
	}

	private async snapshotWithOpenStream(
		body: ReadableStream<Uint8Array>,
	): Promise<RunView | null> {
		try {
			return await this.synchronizeSnapshot()
		} catch (error) {
			await cancelStream(body)
			throw error
		}
	}

	private async synchronizeSnapshot(): Promise<RunView | null> {
		// Queue a fresh fetch after the stream opens; an earlier poll cannot
		// cover events emitted before this stream subscribed.
		const runView = await this.loadRunView(this.controller.signal)
		if (this.stopped || runView === null) return null
		slog(
			"stream",
			`session snapshot runId=${this.runId} entries=${runView.message_trace.length}`,
		)
		return runView
	}

	private async consumeStream(body: ReadableStream<Uint8Array>): Promise<void> {
		for await (const frame of parsePipeEventStream(
			body,
			this.controller.signal,
		)) {
			if (this.stopped) return
			this.consecutiveFailures = 0
			const terminal = isRootTerminalFrame(frame)
			this.dispatchFrameIfNew(frame)
			if (terminal) return
		}

		if (this.stopped) return
		throw new Error("stream closed before the root terminal event")
	}

	private dispatchFrameIfNew(frame: PipeEventFrame) {
		const sequence = getFrameSequence(frame)
		if (sequence <= this.lastSequence) return

		this.lastSequence = sequence
		this.dispatch({
			class: "stream",
			type: "frame_received",
			frame,
		})
	}

	private async waitBeforeReconnect(error: unknown) {
		const delayMs = Math.min(
			RECONNECT_MAX_DELAY_MS,
			RECONNECT_BASE_DELAY_MS * 2 ** this.consecutiveFailures,
		)
		this.consecutiveFailures += 1
		swarn(
			"stream",
			`session stream reconnecting runId=${this.runId} delayMs=${delayMs}`,
			error,
		)
		await abortableDelay(delayMs, this.controller.signal)
	}
}

async function cancelStream(body: ReadableStream<Uint8Array>) {
	try {
		await body.cancel()
	} catch {
		// Stream cleanup is best effort after a terminal run.
	}
}
