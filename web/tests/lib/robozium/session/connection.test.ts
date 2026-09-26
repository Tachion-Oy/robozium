import { WireLifecycleStatus } from "@/lib/robozium/wire"
import { afterEach, describe, expect, it, vi } from "vitest"

import { startRunSessionConnection } from "../../../../lib/robozium/session/connection"
import { createInitialRunSessionState, reduceRunSessionState, type SessionEvent } from "../../../../lib/robozium/session/reducer"
import {
	PipeEventType,
	RunLifecycleKind,
	type PipeEventFrame,
	type RunView,
} from "../../../../lib/robozium/wire"

const encoder = new TextEncoder()

function eventStream(frames: object[]): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const frame of frames) {
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`))
			}
			controller.close()
		},
	})
}

function streamResponse(frames: object[], status = 200): Response {
	return new Response(eventStream(frames), {
		status,
		headers: { "Content-Type": "text/event-stream" },
	})
}

function viewResponse(runView: RunView): Response {
	return new Response(JSON.stringify(runView), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	})
}

function runningView(messageTrace: RunView["message_trace"]): RunView {
	return {
		project: "alpha",
		status: "running",
		current_agent_name: "root",
		parent_agent_name: null,
		message_trace: messageTrace,
		current_prompt_id: null,
		current_prompt: null,
		error: null,
	}
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2500) {
	const deadline = Date.now() + timeoutMs
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error("timed out waiting for condition")
		await new Promise((resolve) => window.setTimeout(resolve, 10))
	}
}

afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe("run session stream connection", () => {
	it("reconnects after early EOF and recovers snapshot frames exactly once", async () => {
		const firstMessage = {
			type: PipeEventType.ScriptOutput,
			sequence: 1,
			payload: { content: "first" },
		} satisfies PipeEventFrame
		const missedMessage = {
			type: PipeEventType.ScriptOutput,
			sequence: 2,
			payload: { content: "missed" },
		} satisfies PipeEventFrame
		const missedRetry = {
			type: PipeEventType.RuntimeEvent,
			sequence: 3,
			payload: {
				category: "llm",
				kind: "retrying",
				level: "info",
				message: "LLM call retrying",
				agent_name: "root",
				data: { attempt: 2 },
			},
		} satisfies PipeEventFrame
		const terminal = {
			type: PipeEventType.RunLifecycle,
			payload: {
				kind: RunLifecycleKind.Stopped,
				agent_name: "root",
				parent_agent_name: null,
				sequence: 4,
				status: WireLifecycleStatus.Completed,
			},
		} satisfies PipeEventFrame
		let streamRequests = 0
		let viewRequests = 0

		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input)
				if (url.endsWith("/stream")) {
					streamRequests += 1
					return streamRequests === 1
						? streamResponse([])
						: streamResponse([terminal])
				}
				if (url.endsWith("/view")) {
					viewRequests += 1
					return viewResponse(
						runningView(
							viewRequests === 1
								? [firstMessage]
								: [firstMessage, missedMessage, missedRetry],
						),
					)
				}
				throw new Error(`unexpected fetch: ${url}`)
			}),
		)
		const events: SessionEvent[] = []
		let state = createInitialRunSessionState("run-1")
		const dispose = startRunSessionConnection("run-1", (event) => {
			events.push(event)
			state = reduceRunSessionState(state, event)
		})

		await waitUntil(() =>
			events.some(
				(event) =>
					event.class === "stream" &&
					event.type === "frame_received" &&
					event.frame.type === "run_lifecycle",
			),
		)
		dispose()

		const receivedSequences = events.flatMap((event) =>
			event.class === "stream" && event.type === "frame_received"
				? [
						event.frame.type === "run_lifecycle"
							? event.frame.payload.sequence
							: event.frame.sequence,
					]
				: [],
		)
		expect(streamRequests).toBe(2)
		expect(viewRequests).toBe(2)
		expect(receivedSequences).toEqual([2, 3, 4])
		expect(state.hud.messages.map(message => message.text)).toEqual(["firstmissed"])
		expect(state.log.items.filter(item => item.role === "script")).toHaveLength(1)
		const pollIndex = events.findIndex(event => event.class === "runView" && event.source === "poll")
		expect(events[pollIndex - 1]).toMatchObject({ class: "stream", frame: { sequence: 3 } })
		expect(
			events.some(
				(event) =>
					event.class === "stream" &&
					(event.type === "failed" || event.type === "open_failed"),
			),
		).toBe(false)
	})

	it("recovers missing output before a terminal reconnect snapshot", async () => {
		const first = { type: PipeEventType.ScriptOutput, sequence: 1, payload: { content: "a" } } satisfies PipeEventFrame
		const missed = { type: PipeEventType.ScriptOutput, sequence: 2, payload: { content: "b" } } satisfies PipeEventFrame
		let views = 0
		vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
			if (String(input).endsWith("/stream")) return streamResponse([])
			views += 1
			return viewResponse(views === 1 ? runningView([first]) : {
				...runningView([first, missed]), status: "completed",
			})
		}))
		let state = createInitialRunSessionState("run-1")
		const dispose = startRunSessionConnection("run-1", event => {
			state = reduceRunSessionState(state, event)
		})
		try {
			await waitUntil(() => state.hud.status === "completed")
			expect(state.hud.messages.map(message => message.text)).toEqual(["ab"])
			expect(state.log.items).toHaveLength(1)
		} finally {
			dispose()
		}
	})

	it("treats a 409 stream response as a terminal snapshot race", async () => {
		let streamRequests = 0
		const terminalView: RunView = {
			...runningView([]),
			status: "completed",
			current_agent_name: null,
		}
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input)
				if (url.endsWith("/stream")) {
					streamRequests += 1
					return new Response("run already finished", { status: 409 })
				}
				if (url.endsWith("/view")) return viewResponse(terminalView)
				throw new Error(`unexpected fetch: ${url}`)
			}),
		)
		const events: SessionEvent[] = []
		const dispose = startRunSessionConnection("run-1", (event) =>
			events.push(event),
		)

		await waitUntil(() =>
			events.some(
				(event) =>
					event.class === "runView" && event.runView.status === "completed",
			),
		)
		await new Promise((resolve) => window.setTimeout(resolve, 550))
		dispose()

		expect(streamRequests).toBe(1)
		expect(
			events.some(
				(event) =>
					event.class === "stream" &&
					(event.type === "failed" || event.type === "open_failed"),
			),
		).toBe(false)
	})

	it("surfaces a permanent stream response without reconnecting", async () => {
		let streamRequests = 0
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				streamRequests += 1
				return new Response("unknown run", { status: 404 })
			}),
		)
		const events: SessionEvent[] = []
		const dispose = startRunSessionConnection("missing", (event) =>
			events.push(event),
		)

		await waitUntil(() =>
			events.some(
				(event) => event.class === "stream" && event.type === "open_failed",
			),
		)
		dispose()

		expect(streamRequests).toBe(1)
	})

	it("cancels a pending reconnect when the session is disposed", async () => {
		let streamRequests = 0
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input)
				if (url.endsWith("/stream")) {
					streamRequests += 1
					return streamResponse([])
				}
				if (url.endsWith("/view")) return viewResponse(runningView([]))
				throw new Error(`unexpected fetch: ${url}`)
			}),
		)
		const events: SessionEvent[] = []
		const dispose = startRunSessionConnection("run-1", (event) =>
			events.push(event),
		)

		await waitUntil(() =>
			events.some((event) => event.class === "runView"),
		)
		dispose()
		await new Promise((resolve) => window.setTimeout(resolve, 550))

		expect(streamRequests).toBe(1)
	})

	it("does not warn or reconnect when disposal aborts a live reader", async () => {
		let streamRequests = 0
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input)
				if (url.endsWith("/stream")) {
					streamRequests += 1
					const signal = init?.signal
					const stream = new ReadableStream<Uint8Array>({
						start(controller) {
							signal?.addEventListener(
								"abort",
								() =>
									controller.error(
										new DOMException("aborted", "AbortError"),
									),
								{ once: true },
							)
						},
					})
					return new Response(stream, { status: 200 })
				}
				if (url.endsWith("/view")) return viewResponse(runningView([]))
				throw new Error(`unexpected fetch: ${url}`)
			}),
		)
		const events: SessionEvent[] = []
		const dispose = startRunSessionConnection("run-1", (event) =>
			events.push(event),
		)

		await waitUntil(() => events.some((event) => event.class === "runView"))
		dispose()
		await new Promise((resolve) => window.setTimeout(resolve, 550))

		expect(streamRequests).toBe(1)
		expect(
			warn.mock.calls.some(([message]) =>
				String(message).includes("[robozium:sse] reader error"),
			),
		).toBe(false)
	})
})
