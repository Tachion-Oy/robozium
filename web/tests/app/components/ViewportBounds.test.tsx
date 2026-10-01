import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ViewportBounds } from "../../../app/components/ViewportBounds"

let viewport: EventTarget & { height: number; width: number; offsetTop: number; offsetLeft: number; scale: number }

beforeEach(() => {
	viewport = Object.assign(new EventTarget(), { height: 900, width: 1600, offsetTop: 0, offsetLeft: 0, scale: 1 })
	vi.stubGlobal("visualViewport", viewport)
})

afterEach(() => {
	cleanup()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe("ViewportBounds", () => {
	it("keeps one subscription through layout rerenders and tears down on unmount", async () => {
		const subscribe = vi.spyOn(viewport, "addEventListener")
		const unsubscribe = vi.spyOn(viewport, "removeEventListener")
		const windowSubscribe = vi.spyOn(window, "addEventListener")
		const { rerender, unmount } = render(<ViewportBounds />)
		const style = document.documentElement.style
		await waitFor(() => expect(style.getPropertyValue("--landing-viewport-height")).toBe("900px"))
		rerender(<ViewportBounds />)
		expect(subscribe.mock.calls.map(([event]) => event)).toEqual(["resize", "scroll"])
		expect(windowSubscribe.mock.calls.filter(([event]) => event === "resize")).toHaveLength(1)
		expect(unsubscribe).not.toHaveBeenCalled()

		viewport.height = 650
		viewport.offsetTop = 140
		viewport.width = 240
		viewport.offsetLeft = 60
		viewport.dispatchEvent(new Event("resize"))
		viewport.dispatchEvent(new Event("scroll"))
		await waitFor(() => expect(style.getPropertyValue("--landing-viewport-height")).toBe("650px"))
		expect(style.getPropertyValue("--landing-viewport-top")).toBe("140px")
		expect(style.getPropertyValue("--landing-viewport-width")).toBe("240px")
		expect(style.getPropertyValue("--landing-viewport-left")).toBe("60px")

		unmount()
		expect(unsubscribe.mock.calls.map(([event]) => event)).toEqual(["resize", "scroll"])
		expect(style.getPropertyValue("--landing-viewport-height")).toBe("")
		expect(style.getPropertyValue("--landing-viewport-top")).toBe("")
		expect(style.getPropertyValue("--landing-viewport-width")).toBe("")
		expect(style.getPropertyValue("--landing-viewport-left")).toBe("")
	})

	it("uses the window when VisualViewport is unavailable", async () => {
		vi.stubGlobal("visualViewport", undefined)
		render(<ViewportBounds />)
		fireEvent(window, new Event("resize"))
		await waitFor(() => expect(document.documentElement.style.getPropertyValue("--landing-viewport-height")).toBe(`${window.innerHeight}px`))
	})
})
