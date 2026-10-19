import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

vi.mock("@/lib/robozium/public-config", () => ({
	HUB_HOME_ARIA_LABEL: "Hub home",
}))
import { OnboardingHud } from "../../../../../app/components/hud/onboarding/OnboardingHud"

afterEach(cleanup)

function arrow(name: string) {
	return screen.getByRole<HTMLButtonElement>("button", { name })
}

describe("OnboardingHud", () => {
	it("pages through the guide with the message arrows", () => {
		render(<OnboardingHud layoutMode="top" onExit={() => {}} />)
		expect(screen.getByRole("heading", { name: "Welcome to Robozium" })).not.toBeNull()
		expect(arrow("Jump to first agent message").disabled).toBe(true)

		fireEvent.click(arrow("Next agent message"))
		expect(screen.getByRole("heading", { name: "1. Get an API key" })).not.toBeNull()
		expect(screen.getByRole("link", { name: "OpenRouter keys" })).not.toBeNull()

		fireEvent.click(arrow("Jump to latest agent message"))
		expect(screen.getByRole("heading", { name: "Optional: encrypt your keys" })).not.toBeNull()
		expect(arrow("Next agent message").disabled).toBe(true)
		expect(arrow("Jump to latest agent message").disabled).toBe(true)

		fireEvent.click(arrow("Previous agent message"))
		expect(screen.getByRole("heading", { name: "4. Restart Robozium" })).not.toBeNull()
		expect(screen.getByRole("img", { name: "A terminal running ./start" })).not.toBeNull()

		fireEvent.click(arrow("Jump to first agent message"))
		expect(screen.getByRole("heading", { name: "Welcome to Robozium" })).not.toBeNull()
	})

	it("returns to Runs Overview when stepping back from the first page", () => {
		const onExit = vi.fn()
		render(<OnboardingHud layoutMode="top" onExit={onExit} />)
		fireEvent.click(arrow("Previous agent message"))
		expect(onExit).toHaveBeenCalledOnce()
	})

	it("disables every control except the message arrows", () => {
		render(<OnboardingHud layoutMode="top" onExit={() => {}} />)
		const enabled = screen
			.getAllByRole<HTMLButtonElement>("button")
			.filter((button) => !button.disabled)
			.map((button) => button.getAttribute("aria-label"))
		expect(enabled).toEqual(["Previous agent message", "Next agent message", "Jump to latest agent message"])
		expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Reply text" }).disabled).toBe(true)
	})
})
