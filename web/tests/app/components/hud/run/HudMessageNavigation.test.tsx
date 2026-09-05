import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { AgentActivityState } from "../../../../../lib/robosprawl/session/reducer"
import { HudMessageNavigation } from "../../../../../app/components/hud/run/HudMessageNavigation"

const allDirections = {
	first: true,
	previous: true,
	next: true,
	latest: true,
}

describe("HudMessageNavigation", () => {
	it("routes all four controls through one directional callback", () => {
		const onNavigate = vi.fn()
		const { container } = render(
			<HudMessageNavigation
				agentActivityState={AgentActivityState.Working}
				enabled={allDirections}
				onNavigate={onNavigate}
			/>,
		)

		fireEvent.click(
			screen.getByRole("button", { name: "Jump to first agent message" }),
		)
		fireEvent.click(
			screen.getByRole("button", { name: "Previous agent message" }),
		)
		fireEvent.click(screen.getByRole("button", { name: "Next agent message" }))
		fireEvent.click(
			screen.getByRole("button", { name: "Jump to latest agent message" }),
		)

		expect(onNavigate.mock.calls).toEqual([
			["first"],
			["previous"],
			["next"],
			["latest"],
		])
		expect(
			container.querySelectorAll(".agent-hud__message-direction"),
		).toHaveLength(4)
		for (const jumpButton of [
			screen.getByRole("button", { name: "Jump to first agent message" }),
			screen.getByRole("button", { name: "Jump to latest agent message" }),
		]) {
			expect(
				jumpButton.querySelectorAll(".agent-hud__message-wedge--jump path"),
			).toHaveLength(2)
		}
	})

	it("disables every direction when no history is available", () => {
		render(
			<HudMessageNavigation
				agentActivityState={AgentActivityState.Working}
				enabled={{
					first: false,
					previous: false,
					next: false,
					latest: false,
				}}
				onNavigate={() => {}}
			/>,
		)

		for (const name of [
			"Jump to first agent message",
			"Previous agent message",
			"Next agent message",
			"Jump to latest agent message",
		]) {
			expect(
				(screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
			).toBe(true)
		}
	})

	it("does not decorate the next direction when it is available", () => {
		render(
			<HudMessageNavigation
				agentActivityState={AgentActivityState.AwaitingInput}
				enabled={allDirections}
				onNavigate={() => {}}
			/>,
		)

		expect(
			screen
				.getByRole("button", { name: "Next agent message" })
				.hasAttribute("data-new-message"),
		).toBe(false)
		expect(screen.queryByRole("status")).toBeNull()
	})
})
