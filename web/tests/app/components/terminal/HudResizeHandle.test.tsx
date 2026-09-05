import { createElement } from "react"
import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import {
	HudResizeHandle,
	useHudResizeDimensions,
} from "../../../../app/components/terminal/HudResizeHandle"

beforeAll(() => {
	Object.defineProperty(window, "innerWidth", {
		value: 1920,
		configurable: true,
	})
	Object.defineProperty(window, "innerHeight", {
		value: 1080,
		configurable: true,
	})
})

beforeEach(() => {
	document.documentElement.style.fontSize = "12px"
	document.documentElement.style.setProperty("--app-ui-scale", "0.75")
})

function renderHandle(progress: number, onProgressChange = vi.fn()) {
	return {
		onProgressChange,
		...render(
			createElement(HudResizeHandle, {
				progress,
				onProgressChange,
				onResizingChange: () => {},
			}),
		),
	}
}

describe("HudResizeHandle", () => {
	it("leaves the run navigation rail exposed at maximum size", async () => {
		const { result, rerender } = renderHook(
			({ progress }) => useHudResizeDimensions(progress),
			{ initialProps: { progress: 1 } },
		)

		await waitFor(() => expect(result.current).toBeDefined())
		expect(result.current?.width).toBeCloseTo(1497.6)
		expect(result.current?.height).toBeCloseTo(907.2)

		rerender({ progress: 0 })
		expect(result.current).toEqual({ width: 816, height: 480 })
	})

	it("keeps viewport bounds independent from the rem density token", async () => {
		document.documentElement.style.fontSize = "16px"
		document.documentElement.style.removeProperty("--app-ui-scale")
		const { result } = renderHook(() => useHudResizeDimensions(1))

		await waitFor(() => expect(result.current).toBeDefined())
		expect(result.current?.width).toBeCloseTo(1497.6)
		expect(result.current?.height).toBeCloseTo(907.2)
	})

	it("exposes the current size and supports keyboard resizing", () => {
		const { onProgressChange } = renderHandle(0.5)
		const handle = screen.getByRole("slider", { name: "Resize HUD" })
		expect(handle.getAttribute("aria-valuenow")).toBe("50")

		for (const key of ["ArrowRight", "ArrowDown", "Home", "End"]) {
			fireEvent.keyDown(handle, { key })
		}
		expect(onProgressChange.mock.calls.map(([value]) => value)).toEqual([
			0.55,
			0.45,
			0,
			1,
		])
	})

	it("renders a conventional horizontal double-arrow", () => {
		const { container } = renderHandle(0.5)
		expect(
			container.querySelector(".agent-hud__resize-icon path")?.getAttribute("d"),
		).toBe("M8 5.5 3.5 10 8 14.5M3.5 10h13M12 5.5l4.5 4.5-4.5 4.5")
	})

	it("drags along the resize path", () => {
		const onProgressChange = vi.fn()
		const onResizingChange = vi.fn()
		render(
			createElement(HudResizeHandle, {
				progress: 0,
				onProgressChange,
				onResizingChange,
			}),
		)
		const handle = screen.getByRole("slider", { name: "Resize HUD" })
		Object.defineProperty(handle, "setPointerCapture", { value: vi.fn() })

		fireEvent.pointerDown(handle, {
			pointerId: 7,
			button: 0,
			clientX: 100,
			clientY: 100,
		})
		fireEvent.pointerMove(handle, {
			pointerId: 7,
			clientX: 36,
			clientY: 150,
		})
		fireEvent.pointerUp(handle, { pointerId: 7 })

		expect(onProgressChange.mock.lastCall?.[0]).toBeGreaterThan(0)
		expect(onResizingChange.mock.calls).toEqual([[true], [false]])
	})

	it("coalesces pointer moves to one update per animation frame", () => {
		let frameCallback: FrameRequestCallback | null = null
		const requestFrame = vi
			.spyOn(window, "requestAnimationFrame")
			.mockImplementation((callback) => {
				frameCallback = callback
				return 1
			})
		const cancelFrame = vi
			.spyOn(window, "cancelAnimationFrame")
			.mockImplementation(() => {})
		const onProgressChange = vi.fn()
		renderHandle(0, onProgressChange)
		const handle = screen.getByRole("slider", { name: "Resize HUD" })
		Object.defineProperty(handle, "setPointerCapture", { value: vi.fn() })

		fireEvent.pointerDown(handle, {
			pointerId: 8,
			button: 0,
			clientX: 100,
			clientY: 100,
		})
		fireEvent.pointerMove(handle, {
			pointerId: 8,
			clientX: 80,
			clientY: 120,
		})
		fireEvent.pointerMove(handle, {
			pointerId: 8,
			clientX: 36,
			clientY: 150,
		})

		expect(requestFrame).toHaveBeenCalledTimes(1)
		expect(onProgressChange).not.toHaveBeenCalled()
		if (frameCallback) frameCallback(16)
		expect(onProgressChange).toHaveBeenCalledTimes(1)
		expect(onProgressChange.mock.lastCall?.[0]).toBeGreaterThan(0)

		fireEvent.pointerUp(handle, { pointerId: 8 })
		requestFrame.mockRestore()
		cancelFrame.mockRestore()
	})

	it("clicks between the endpoints without toggling after a drag", () => {
		const onProgressChange = vi.fn()
		const { rerender } = renderHandle(0.4, onProgressChange)
		const handle = screen.getByRole("slider", { name: "Resize HUD" })

		fireEvent.click(handle)
		expect(onProgressChange).toHaveBeenLastCalledWith(1)
		rerender(
			createElement(HudResizeHandle, {
				progress: 1,
				onProgressChange,
				onResizingChange: () => {},
			}),
		)
		fireEvent.click(handle)
		expect(onProgressChange).toHaveBeenLastCalledWith(0)

		Object.defineProperty(handle, "setPointerCapture", { value: vi.fn() })
		fireEvent.pointerDown(handle, {
			pointerId: 9,
			button: 0,
			clientX: 100,
			clientY: 100,
		})
		fireEvent.pointerMove(handle, {
			pointerId: 9,
			clientX: 36,
			clientY: 150,
		})
		fireEvent.pointerUp(handle, { pointerId: 9 })
		const callsAfterDrag = onProgressChange.mock.calls.length
		fireEvent.click(handle)
		expect(onProgressChange).toHaveBeenCalledTimes(callsAfterDrag)
	})
})
