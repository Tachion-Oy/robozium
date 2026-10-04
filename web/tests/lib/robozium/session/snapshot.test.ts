import { afterEach, describe, expect, it, vi } from "vitest"
import { createRunViewLoader } from "../../../../lib/robozium/session/snapshot"
import {
	createInitialRunSessionState,
	reduceRunSessionState,
	type SessionEvent,
} from "../../../../lib/robozium/session/reducer"
import { PipeEventType, WireRole, type RunView } from "../../../../lib/robozium/wire"

const runningView: RunView = {
	project: "alpha",
	status: "running",
	current_agent_name: "root",
	parent_agent_name: null,
	message_trace: [{
		type: PipeEventType.Message,
		sequence: 1,
		payload: { role: WireRole.Assistant, content: "Question", truncation: null },
	}],
	current_prompt_id: null,
	current_prompt: null,
	error: null,
}

function deferredResponse() {
	let resolve!: (response: Response) => void
	const promise = new Promise<Response>((settle) => { resolve = settle })
	return { promise, resolve }
}

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe("session snapshot loader", () => {
	it("applies a snapshot before fetching a newer prompt with the same event index", async () => {
		const first = deferredResponse()
		const promptingView: RunView = {
			...runningView,
			status: "awaiting_user_input",
			current_prompt_id: "p-1",
			current_prompt: "Question",
		}
		const nextPromptingView: RunView = {
			...promptingView,
			current_prompt_id: "p-2",
			current_prompt: "Follow-up question",
		}
		let state = createInitialRunSessionState("run-1")
		const fetch = vi.fn()
			.mockReturnValueOnce(first.promise)
			.mockImplementationOnce(() => {
				expect(state.hud.status).toBe("running")
				expect(state.log.appliedSequence).toBe(1)
				return Promise.resolve(Response.json(promptingView))
			})
			.mockImplementationOnce(() => {
				expect(state.hud.promptId).toBe("p-1")
				return Promise.resolve(Response.json(nextPromptingView))
			})
		vi.stubGlobal("fetch", fetch)
		const load = createRunViewLoader("run-1", (event) => {
			state = reduceRunSessionState(state, event)
		})
		const poll = load(new AbortController().signal)
		const recovery = load(new AbortController().signal)
		const nextPoll = load(new AbortController().signal)
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
		first.resolve(Response.json(runningView))
		await expect(poll).resolves.toEqual(runningView)
		await expect(recovery).resolves.toEqual(promptingView)
		await expect(nextPoll).resolves.toEqual(nextPromptingView)

		expect(fetch).toHaveBeenCalledTimes(3)
		expect(state.hud).toMatchObject({ status: "awaiting_user_input", promptId: "p-2" })
		expect(state.log.appliedSequence).toBe(1)
		expect(state.log.items).toHaveLength(1)
	})

	it("continues with a queued snapshot after the preceding request fails", async () => {
		const fetch = vi.fn()
			.mockResolvedValueOnce(Response.json({ detail: "Unavailable" }, { status: 503 }))
			.mockResolvedValueOnce(Response.json(runningView))
		vi.stubGlobal("fetch", fetch)
		const dispatch = vi.fn<(event: SessionEvent) => void>()
		const load = createRunViewLoader("run-1", dispatch)
		const failed = load(new AbortController().signal)
		const recovered = load(new AbortController().signal)
		await expect(failed).rejects.toThrow("Unavailable")
		await expect(recovered).resolves.toEqual(runningView)
		expect(dispatch).toHaveBeenCalledExactlyOnceWith({
			class: "runView", type: "received", runView: runningView,
		})
	})

	it("times out a stalled poll so a queued recovery can fetch and apply its snapshot", async () => {
		const timeout = new AbortController()
		vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(timeout.signal)
		const fetch = vi.fn()
			.mockImplementationOnce((_url: string, init: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					const signal = init.signal!
					signal.addEventListener("abort", () => reject(signal.reason), { once: true })
				}),
			)
			.mockResolvedValueOnce(Response.json(runningView))
		vi.stubGlobal("fetch", fetch)
		const dispatch = vi.fn<(event: SessionEvent) => void>()
		const load = createRunViewLoader("run-1", dispatch)
		const pollController = new AbortController()
		const poll = load(pollController.signal)
		const recovery = load(new AbortController().signal)
		const failed = expect(poll).rejects.toMatchObject({ name: "TimeoutError" })
		expect(fetch).toHaveBeenCalledTimes(1)

		timeout.abort(new DOMException("The operation timed out.", "TimeoutError"))
		await failed
		await expect(recovery).resolves.toEqual(runningView)
		expect(fetch).toHaveBeenCalledTimes(2)
		expect(pollController.signal.aborted).toBe(false)
		expect(dispatch).toHaveBeenCalledExactlyOnceWith({
			class: "runView", type: "received", runView: runningView,
		})
	})

	it("allows a slower recovery snapshot to complete after a timeout", async () => {
		vi.useFakeTimers()
		// Advance the native deadline through the test clock.
		vi.spyOn(AbortSignal, "timeout").mockImplementation((delayMs) => {
			const controller = new AbortController()
			window.setTimeout(() => {
				controller.abort(new DOMException("The operation timed out.", "TimeoutError"))
			}, delayMs)
			return controller.signal
		})
		const fetch = vi.fn((_url: string, init: RequestInit) =>
			new Promise<Response>((resolve, reject) => {
				const signal = init.signal!
				signal.addEventListener("abort", () => reject(signal.reason), { once: true })
				window.setTimeout(() => resolve(Response.json(runningView)), 12_000)
			}),
		)
		vi.stubGlobal("fetch", fetch)
		const dispatch = vi.fn<(event: SessionEvent) => void>()
		const load = createRunViewLoader("run-1", dispatch)
		const poll = load(new AbortController().signal)
		const recovery = load(new AbortController().signal)
		const failed = expect(poll).rejects.toMatchObject({ name: "TimeoutError" })

		await vi.advanceTimersByTimeAsync(10_000)
		await failed
		expect(dispatch).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(12_000)
		await expect(recovery).resolves.toEqual(runningView)
		expect(fetch).toHaveBeenCalledTimes(2)
		expect(dispatch).toHaveBeenCalledExactlyOnceWith({
			class: "runView", type: "received", runView: runningView,
		})
	})

	it("discards an aborted response and skips an aborted queued request", async () => {
		const first = deferredResponse()
		const fetch = vi.fn().mockReturnValueOnce(first.promise)
		vi.stubGlobal("fetch", fetch)
		const dispatch = vi.fn<(event: SessionEvent) => void>()
		const load = createRunViewLoader("run-1", dispatch)
		const pollController = new AbortController()
		const recoveryController = new AbortController()
		const poll = load(pollController.signal)
		const recovery = load(recoveryController.signal)
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
		const requestSignal = fetch.mock.calls[0][1].signal as AbortSignal
		pollController.abort()
		expect(requestSignal.aborted).toBe(true)
		recoveryController.abort()
		first.resolve(Response.json(runningView))
		await expect(poll).resolves.toBeNull()
		await expect(recovery).resolves.toBeNull()
		expect(fetch).toHaveBeenCalledTimes(1)
		expect(dispatch).not.toHaveBeenCalled()
	})
})
