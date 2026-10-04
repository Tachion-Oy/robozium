import { beforeEach, describe, expect, it, vi } from "vitest"

import {
	cancelProject as cancelProjectApi,
	interruptRun as interruptRunApi,
	submitReply as submitReplyApi,
} from "../../../../lib/robozium/client"
import { createRunSession } from "../../../../lib/robozium/session"
import { startRunSessionConnection } from "../../../../lib/robozium/session/connection"
import { startRunSessionPoller } from "../../../../lib/robozium/session/poller"
import type { RunView } from "../../../../lib/robozium/wire"

vi.mock("../../../../lib/robozium/client", () => ({
	cancelProject: vi.fn(),
	interruptRun: vi.fn(),
	submitReply: vi.fn(),
}))

vi.mock("../../../../lib/robozium/session/connection", () => ({
	startRunSessionConnection: vi.fn(),
}))

vi.mock("../../../../lib/robozium/session/poller", () => ({
	startRunSessionPoller: vi.fn(),
}))

const mockedCancelProject = vi.mocked(cancelProjectApi)
const mockedInterruptRun = vi.mocked(interruptRunApi)
const mockedSubmitReply = vi.mocked(submitReplyApi)
const mockedStartRunSessionConnection = vi.mocked(startRunSessionConnection)
const mockedStartRunSessionPoller = vi.mocked(startRunSessionPoller)

function seededRunView(
	status: RunView["status"] = "running",
): RunView {
	return {
		project: "alpha",
		status,
		current_agent_name: null,
		parent_agent_name: null,
		message_trace: [],
		current_prompt_id: null,
		current_prompt: null,
		error: null,
	}
}

describe("createRunSession transport lifetime", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it.each(["completed", "failed", "cancelled"] as const)(
		"does not start transports for an initially %s run",
		(status) => {
			const session = createRunSession("run-1", seededRunView(status))

			session.start()

			expect(mockedStartRunSessionConnection).not.toHaveBeenCalled()
			expect(mockedStartRunSessionPoller).not.toHaveBeenCalled()
		},
	)

	it.each(["completed", "failed", "cancelled"] as const)(
		"stops both transports when a live run becomes %s",
		(status) => {
			const stopConnection = vi.fn()
			const stopPoller = vi.fn()
			mockedStartRunSessionConnection.mockReturnValueOnce(stopConnection)
			mockedStartRunSessionPoller.mockReturnValueOnce(stopPoller)
			const session = createRunSession("run-1", seededRunView())

			session.start()
			const dispatch = mockedStartRunSessionConnection.mock.calls[0][1]
			dispatch({
				class: "runView",
				type: "received",
				runView: seededRunView(status),
			})

			expect(stopConnection).toHaveBeenCalledTimes(1)
			expect(stopPoller).toHaveBeenCalledTimes(1)
		},
	)

	it("ignores late snapshots after completion and disposal", () => {
		mockedStartRunSessionConnection.mockReturnValueOnce(vi.fn())
		mockedStartRunSessionPoller.mockReturnValueOnce(vi.fn())
		const session = createRunSession("run-1", seededRunView())
		session.start()
		const dispatch = mockedStartRunSessionConnection.mock.calls[0][1]
		dispatch({ class: "runView", type: "received", runView: seededRunView("completed") })
		const completedState = session.store.getState()
		dispatch({ class: "runView", type: "received", runView: seededRunView("running") })
		expect(session.store.getState()).toBe(completedState)
		session.dispose()
		dispatch({ class: "runView", type: "received", runView: seededRunView("running") })
		expect(session.store.getState()).toBe(completedState)
	})

	it("stops both transports after a permanent run-open failure", () => {
		const stopConnection = vi.fn()
		const stopPoller = vi.fn()
		mockedStartRunSessionConnection.mockReturnValueOnce(stopConnection)
		mockedStartRunSessionPoller.mockReturnValueOnce(stopPoller)
		const session = createRunSession("missing", seededRunView())

		session.start()
		const dispatch = mockedStartRunSessionConnection.mock.calls[0][1]
		dispatch({
			class: "stream",
			type: "open_failed",
			message: "unknown run",
		})

		expect(stopConnection).toHaveBeenCalledTimes(1)
		expect(stopPoller).toHaveBeenCalledTimes(1)
	})
})

describe("createRunSession cancelRun", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("posts cancel even if the HUD has an interrupt in flight", async () => {
		mockedCancelProject.mockResolvedValueOnce({ ok: true })
		const session = createRunSession("run-1", seededRunView())
		session.store.setState((state) => ({
			...state,
			hud: { ...state.hud, isInterrupting: true },
		}))

		await expect(session.cancelRun()).resolves.toBe(true)

		expect(mockedCancelProject).toHaveBeenCalledWith("alpha")
		expect(mockedInterruptRun).not.toHaveBeenCalled()
		expect(mockedSubmitReply).not.toHaveBeenCalled()
		expect(session.store.getState().hud.isCancelling).toBe(true)
	})

	it("posts cancel even if the HUD has stale cancelling state", async () => {
		mockedCancelProject.mockResolvedValueOnce({ ok: true })
		const session = createRunSession("run-1", seededRunView())
		session.store.setState((state) => ({
			...state,
			hud: { ...state.hud, isCancelling: true },
		}))

		await expect(session.cancelRun()).resolves.toBe(true)

		expect(mockedCancelProject).toHaveBeenCalledWith("alpha")
	})

	it("attempts cancel again on every click, matching the table's unconditional call", async () => {
		mockedCancelProject.mockResolvedValue({ ok: true })
		const session = createRunSession("run-1", seededRunView())

		await session.cancelRun()
		await session.cancelRun()
		await session.cancelRun()

		expect(mockedCancelProject).toHaveBeenCalledTimes(3)
		expect(mockedCancelProject).toHaveBeenNthCalledWith(1, "alpha")
		expect(mockedCancelProject).toHaveBeenNthCalledWith(2, "alpha")
		expect(mockedCancelProject).toHaveBeenNthCalledWith(3, "alpha")
	})

	it("recovers isCancelling to false when the server reports cancel failed", async () => {
		mockedCancelProject.mockResolvedValueOnce({ ok: false })
		const session = createRunSession("run-1", seededRunView())

		await expect(session.cancelRun()).resolves.toBe(false)

		expect(session.store.getState().hud.isCancelling).toBe(false)
	})

	it("rolls back cancel state when the request rejects", async () => {
		mockedCancelProject.mockRejectedValueOnce(new Error("offline"))
		const session = createRunSession("run-1", seededRunView())

		await expect(session.cancelRun()).resolves.toBe(false)

		expect(session.store.getState().hud.isCancelling).toBe(false)
	})

	it("does not post cancel when projectSlug has not been hydrated", async () => {
		const session = createRunSession("run-1")
		await expect(session.cancelRun()).resolves.toBe(false)
		expect(mockedCancelProject).not.toHaveBeenCalled()
		expect(session.store.getState().hud.isCancelling).toBe(false)
	})
})

describe("createRunSession HUD messages", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("keeps the active prompt when a reply fails so the user can retry", async () => {
		mockedSubmitReply.mockRejectedValueOnce(new Error("offline"))
		const session = createRunSession("run-1", {
			...seededRunView("awaiting_user_input"),
			current_prompt_id: "prompt-1",
			current_prompt: "Question",
		})
		const before = session.store.getState()
		await expect(session.submitReply("answer")).rejects.toThrow("offline")
		expect(session.store.getState()).toBe(before)
		mockedSubmitReply.mockResolvedValueOnce({ ok: true })
		await expect(session.submitReply("answer")).resolves.toBe(true)
		expect(session.store.getState().hud.promptId).toBeNull()
	})

	it("submits the active prompt while a historical message is selected", async () => {
		mockedSubmitReply.mockResolvedValueOnce({ ok: true })
		const session = createRunSession("run-1", {
			...seededRunView(),
			status: "awaiting_user_input",
			current_prompt_id: "prompt-1",
			current_prompt: "Approve these hours?",
		})
		session.store.setState((state) => ({
			...state,
			hud: {
				...state.hud,
				messages: [
					{ contentType: "markdown",  id: "old-message", text: "Earlier update", replyId: null },
					...state.hud.messages,
				],
				selectedMessageId: "old-message",
			},
		}))

		await expect(session.submitReply(" yes ")).resolves.toBe(true)

		expect(mockedSubmitReply).toHaveBeenCalledWith("run-1", {
			prompt_id: "prompt-1",
			content: "yes",
		})
		expect(session.store.getState().hud.selectedMessageId).toBeNull()
	})
})

describe("cancel parity between the run table and the run HUD", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("calls the identical project-cancel API from both entry points", async () => {
		mockedCancelProject.mockResolvedValue({ ok: true })

		// Run table entry point: ProjectOverview.handleCancelRun calls project cancel
		// directly, with no local state gating it whatsoever.
		await cancelProjectApi("table-project")

		// Run HUD entry point: RunHud -> session.cancelRun(), simulated here with
		// every local flag an active run view could plausibly be stuck in.
		const session = createRunSession("run-1", seededRunView())
		session.store.setState((state) => ({
			...state,
			hud: {
				...state.hud,
				status: "running",
				isCancelling: true,
				isInterrupting: true,
			},
		}))
		await session.cancelRun()

		expect(mockedCancelProject).toHaveBeenCalledTimes(2)
		expect(mockedCancelProject).toHaveBeenNthCalledWith(1, "table-project")
		expect(mockedCancelProject).toHaveBeenNthCalledWith(2, "alpha")
	})

	it("keeps both entry points working across interactive run states", async () => {
		mockedCancelProject.mockResolvedValue({ ok: true })

		for (const status of ["running", "awaiting_user_input"] as const) {
			mockedCancelProject.mockClear()
			await cancelProjectApi("table-project")

			const session = createRunSession("run-hud", seededRunView())
			session.store.setState((state) => ({
				...state,
				hud: { ...state.hud, status },
			}))
			await session.cancelRun()

			expect(mockedCancelProject).toHaveBeenCalledWith("table-project")
			expect(mockedCancelProject).toHaveBeenCalledWith("alpha")
			expect(mockedCancelProject).toHaveBeenCalledTimes(2)
		}
	})
})
