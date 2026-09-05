import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	fetchSeed: vi.fn(),
}))

vi.mock("../../lib/robosprawl/http", () => ({
	fetchSeed: mocks.fetchSeed,
}))

vi.mock("../../app/components/AppView", () => ({
	AppView: () => null,
}))

import Home from "../../app/page"

beforeEach(() => {
	vi.clearAllMocks()
	mocks.fetchSeed.mockResolvedValue(null)
})

describe("Home", () => {
	it("loads the landing model default", async () => {
		await Home({ searchParams: Promise.resolve({}) })

		expect(mocks.fetchSeed).toHaveBeenCalledWith("/models")
		expect(mocks.fetchSeed).toHaveBeenCalledWith("/projects")
	})

	it("loads the model selection scoped to the active run", async () => {
		await Home({ searchParams: Promise.resolve({ runId: "run/id" }) })

		expect(mocks.fetchSeed).toHaveBeenCalledWith("/models")
		expect(mocks.fetchSeed).toHaveBeenCalledWith(
			"/models?run_id=run%2Fid",
		)
		expect(mocks.fetchSeed).toHaveBeenCalledWith("/run/run%2Fid")
		expect(mocks.fetchSeed).toHaveBeenCalledWith("/projects")
	})
})
