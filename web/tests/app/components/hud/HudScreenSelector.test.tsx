import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { HudScreenSelector } from "../../../../app/components/hud/HudScreenSelector"
import type {
	HudScreen,
	HudScreenOption,
} from "../../../../app/components/hud/hudPresentation"

const activeRunOptions: readonly HudScreenOption[] = [
	{ value: "run", label: "Current Run" },
	{ value: "projects", label: "Runs Overview" },
	{ value: "dependencies", label: "Dependencies" },
]

afterEach(() => cleanup())

function renderSelector(
	screenName: HudScreen = "run",
	onSelectScreen = vi.fn(),
) {
	return render(
		<HudScreenSelector
			screen={screenName}
			options={activeRunOptions}
			onSelectScreen={onSelectScreen}
		/>,
	)
}

describe("HudScreenSelector", () => {
	it("renders the screens supplied by the presentation resolver", () => {
		const onSelectScreen = vi.fn()
		renderSelector("run", onSelectScreen)

		fireEvent.click(screen.getByRole("button", { name: "Current Run" }))
		expect(
			screen.getAllByRole("option").map((option) => option.textContent),
		).toEqual(["Current Run●", "Runs Overview", "Dependencies"])

		fireEvent.click(screen.getByRole("option", { name: "Runs Overview" }))
		expect(onSelectScreen).toHaveBeenCalledWith("projects")
		expect(screen.queryByRole("listbox")).toBeNull()
	})

	it("closes without notifying when the selected screen is chosen", () => {
		const onSelectScreen = vi.fn()
		renderSelector("dependencies", onSelectScreen)

		fireEvent.click(screen.getByRole("button", { name: "Dependencies" }))
		fireEvent.click(screen.getByRole("option", { name: "Dependencies" }))
		expect(onSelectScreen).not.toHaveBeenCalled()
		expect(screen.queryByRole("listbox")).toBeNull()
	})

	it("dismisses on outside pointer input and Escape", () => {
		renderSelector()

		const trigger = screen.getByRole("button", { name: "Current Run" })
		fireEvent.click(trigger)
		fireEvent.pointerDown(document.body)
		expect(screen.queryByRole("listbox")).toBeNull()

		fireEvent.click(trigger)
		fireEvent.keyDown(document, { key: "Escape" })
		expect(screen.queryByRole("listbox")).toBeNull()
		expect(document.activeElement).toBe(trigger)
	})

	it("focuses the selected option and wraps arrow-key navigation", () => {
		renderSelector()

		fireEvent.click(screen.getByRole("button", { name: "Current Run" }))
		const current = screen.getByRole("option", { name: "Current Run" })
		const dependencies = screen.getByRole("option", { name: "Dependencies" })
		expect(document.activeElement).toBe(current)

		fireEvent.keyDown(current, { key: "ArrowUp" })
		expect(document.activeElement).toBe(dependencies)
		fireEvent.keyDown(dependencies, { key: "ArrowDown" })
		expect(document.activeElement).toBe(current)
	})
})
