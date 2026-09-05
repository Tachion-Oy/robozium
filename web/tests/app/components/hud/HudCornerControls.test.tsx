import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import {
	HudCornerControls,
	moveLayoutMode,
} from "../../../../app/components/hud/HudCornerControls"

function renderCornerControls(
	overrides: Partial<Parameters<typeof HudCornerControls>[0]["layout"]> = {},
) {
	return render(
		<HudCornerControls
			layout={{
				mode: "equal",
				onMove: () => {},
				onMinimize: () => {},
				...overrides,
			}}
		/>,
	)
}

describe("HudCornerControls", () => {
	it("minimizes from an explicit control and leaves Expand to the minimized widget", () => {
		const onMinimize = vi.fn()
		const { container } = renderCornerControls({ onMinimize })

		fireEvent.click(screen.getByRole("button", { name: "Minimize" }))
		expect(onMinimize).toHaveBeenCalledTimes(1)
		expect(screen.queryByRole("button", { name: "Expand" })).toBeNull()
		expect(container.querySelector(".agent-hud__size-icon")).not.toBeNull()
	})

	it("stacks the icon-only minimize control before the two divider controls", () => {
		const { container } = renderCornerControls()
		const group = screen.getByRole("group", { name: "Panel divider: equal" })
		const rail = container.querySelector(".agent-hud__corner-controls")

		expect(screen.queryByText("Layout")).toBeNull()
		expect(rail?.firstElementChild).toBe(
			screen.getByRole("button", { name: "Minimize" }),
		)
		expect(rail?.lastElementChild).toBe(group)
		expect(group.querySelectorAll("button.agent-hud__layout-direction")).toHaveLength(
			2,
		)
		expect(container.querySelectorAll(".agent-hud__corner-control")).toHaveLength(3)
	})

	it("moves the panel divider in the clicked wedge direction", () => {
		const onMove = vi.fn()
		renderCornerControls({ onMove })

		fireEvent.click(screen.getByRole("button", { name: "Move panel divider up" }))
		fireEvent.click(
			screen.getByRole("button", { name: "Move panel divider down" }),
		)
		expect(onMove.mock.calls).toEqual([["up"], ["down"]])
	})

	it("disables the wedge that points beyond the current layout limit", () => {
		const { rerender } = renderCornerControls({ mode: "top" })
		const up = () =>
			screen.getByRole("button", {
				name: "Move panel divider up",
			}) as HTMLButtonElement
		const down = () =>
			screen.getByRole("button", {
				name: "Move panel divider down",
			}) as HTMLButtonElement

		expect(up().disabled).toBe(false)
		expect(down().disabled).toBe(true)

		rerender(
			<HudCornerControls
				layout={{
					mode: "bottom",
					onMove: () => {},
					onMinimize: () => {},
				}}
			/>,
		)
		expect(up().disabled).toBe(true)
		expect(down().disabled).toBe(false)
	})

	it("keeps the full side stack visible but inactive outside the run view", () => {
		const { container } = render(
			<HudCornerControls
				disabled
				layout={{
					mode: "equal",
					onMove: vi.fn(),
					onMinimize: vi.fn(),
				}}
			/>,
		)
		const buttons = Array.from(
			container.querySelectorAll<HTMLButtonElement>(
				".agent-hud__corner-controls button",
			),
		)

		expect(buttons).toHaveLength(3)
		expect(buttons.every((button) => button.disabled)).toBe(true)
		expect(
			container.querySelector(".agent-hud__corner-controls")?.hasAttribute(
				"data-disabled",
			),
		).toBe(true)
	})
})

describe("moveLayoutMode", () => {
	it("moves up and down through the three seam positions without wrapping", () => {
		expect(moveLayoutMode("top", "up")).toBe("equal")
		expect(moveLayoutMode("equal", "up")).toBe("bottom")
		expect(moveLayoutMode("bottom", "up")).toBe("bottom")
		expect(moveLayoutMode("bottom", "down")).toBe("equal")
		expect(moveLayoutMode("equal", "down")).toBe("top")
		expect(moveLayoutMode("top", "down")).toBe("top")
	})
})
