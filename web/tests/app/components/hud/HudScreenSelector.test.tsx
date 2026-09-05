import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { HudScreenSelector } from "../../../../app/components/hud/HudScreenSelector"

afterEach(() => cleanup())

describe("HudScreenSelector", () => {
	it("offers all three views during an active run", () => {
		const onSelectView = vi.fn()
		render(
			<HudScreenSelector
				view="main"
				isLanding={false}
				isRecovery={false}
				onSelectView={onSelectView}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: "Current Run" }))
		expect(
			screen.getAllByRole("option").map((option) => option.textContent),
		).toEqual(["Current Run●", "Runs Overview", "Dependencies"])

		fireEvent.click(
			screen.getByRole("option", { name: "Runs Overview" }),
		)
		expect(onSelectView).toHaveBeenCalledWith("agents")
		expect(screen.queryByRole("listbox")).toBeNull()
	})

	it.each([
		{
			name: "landing",
			view: "main" as const,
			isLanding: true,
			isRecovery: false,
		},
		{
			name: "recovery",
			view: "agents" as const,
			isLanding: false,
			isRecovery: true,
		},
	])("only offers overview and dependencies on $name", (context) => {
		render(
			<HudScreenSelector
				view={context.view}
				isLanding={context.isLanding}
				isRecovery={context.isRecovery}
				onSelectView={vi.fn()}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: "Runs Overview" }))
		expect(
			screen.getAllByRole("option").map((option) => option.textContent),
		).toEqual(["Runs Overview●", "Dependencies"])
		expect(
			screen.queryByRole("option", { name: "Current Run" }),
		).toBeNull()
	})

	it("closes without notifying when the selected view is chosen", () => {
		const onSelectView = vi.fn()
		render(
			<HudScreenSelector
				view="dependencies"
				isLanding={false}
				isRecovery={false}
				onSelectView={onSelectView}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: "Dependencies" }))
		fireEvent.click(
			screen.getByRole("option", { name: "Dependencies" }),
		)
		expect(onSelectView).not.toHaveBeenCalled()
		expect(screen.queryByRole("listbox")).toBeNull()
	})

	it("dismisses on outside pointer input and Escape", () => {
		render(
			<HudScreenSelector
				view="main"
				isLanding={false}
				isRecovery={false}
				onSelectView={vi.fn()}
			/>,
		)

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
		render(
			<HudScreenSelector
				view="main"
				isLanding={false}
				isRecovery={false}
				onSelectView={vi.fn()}
			/>,
		)

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
