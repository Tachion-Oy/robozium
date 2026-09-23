import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
	fetchRunView,
	AgentApiError,
} from "../../../../lib/robozium/client"
import { swarn } from "../../../../lib/robozium/log"
import { startRunSessionPoller } from "../../../../lib/robozium/session/poller"
import type { SessionEvent } from "../../../../lib/robozium/session/reducer"

vi.mock("../../../../lib/robozium/client", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("../../../../lib/robozium/client")>()
	return { ...original, fetchRunView: vi.fn() }
})

vi.mock("../../../../lib/robozium/log", () => ({
	swarn: vi.fn(),
}))

const mockedFetchRunView = vi.mocked(fetchRunView)
const mockedSwarn = vi.mocked(swarn)

beforeEach(() => {
	vi.clearAllMocks()
})

afterEach(() => {
	vi.useRealTimers()
})

describe("startRunSessionPoller", () => {
	it("turns an unknown run into a permanent session failure without warning", async () => {
		mockedFetchRunView.mockRejectedValueOnce(
			new AgentApiError(404, "unknown run_id"),
		)
		const events: SessionEvent[] = []
		const dispose = startRunSessionPoller("missing", (event) =>
			events.push(event),
		)

		await vi.waitFor(() =>
			expect(events).toContainEqual({
				class: "stream",
				type: "open_failed",
				message: "unknown run_id",
			}),
		)
		dispose()

		expect(mockedSwarn).not.toHaveBeenCalled()
	})

	it("keeps warning for transient polling failures", async () => {
		const error = new Error("offline")
		mockedFetchRunView.mockRejectedValueOnce(error)
		const events: SessionEvent[] = []
		const dispose = startRunSessionPoller("run-1", (event) =>
			events.push(event),
		)

		await vi.waitFor(() =>
			expect(mockedSwarn).toHaveBeenCalledWith(
				"hud",
				"run view poll failed runId=run-1",
				error,
			),
		)
		dispose()

		expect(events).toEqual([])
	})
})
