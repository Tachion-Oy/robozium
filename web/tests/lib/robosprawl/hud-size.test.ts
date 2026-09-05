import { beforeEach, describe, expect, it } from "vitest"
import { hudSizeStore, setHudSizeProgress } from "../../../lib/robosprawl/hud-size"

beforeEach(() => hudSizeStore.setState({ progress: 0 }))

describe("hudSizeStore", () => {
	it("starts at the compact landing size", () => {
		expect(hudSizeStore.getState().progress).toBe(0)
	})

	it("clamps shared resize progress", () => {
		setHudSizeProgress(-0.25)
		expect(hudSizeStore.getState().progress).toBe(0)

		setHudSizeProgress(1.25)
		expect(hudSizeStore.getState().progress).toBe(1)
	})
})
