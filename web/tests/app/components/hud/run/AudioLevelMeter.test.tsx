import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { AudioLevelMeter } from "../../../../../app/components/hud/run/AudioLevelMeter"

describe("AudioLevelMeter", () => {
	it("renders six segments and fills them to the supplied level", () => {
		const { container } = render(<AudioLevelMeter level={0.5} />)
		const meter = container.querySelector<HTMLElement>(".agent-hud__dictate-meter")

		expect(meter?.getAttribute("aria-hidden")).toBe("true")
		expect(
			meter?.querySelectorAll(".agent-hud__dictate-meter-segment").length,
		).toBe(6)
		expect(meter?.querySelectorAll("[data-active]").length).toBe(3)
		expect(meter?.hasAttribute("data-silent")).toBe(false)
	})

	it("marks the meter silent without treating its pulse as detected audio", () => {
		const { container } = render(<AudioLevelMeter level={0} />)
		const meter = container.querySelector<HTMLElement>(".agent-hud__dictate-meter")

		expect(meter?.dataset.silent).toBe("true")
		expect(meter?.querySelectorAll("[data-active]").length).toBe(0)
	})

	it("clamps invalid and out-of-range levels", () => {
		const { container, rerender } = render(<AudioLevelMeter level={Number.NaN} />)
		const activeSegments = () =>
			container.querySelectorAll(
				".agent-hud__dictate-meter-segment[data-active]",
			).length

		expect(activeSegments()).toBe(0)
		rerender(<AudioLevelMeter level={2} />)
		expect(activeSegments()).toBe(6)
		rerender(<AudioLevelMeter level={-1} />)
		expect(activeSegments()).toBe(0)
	})
})
