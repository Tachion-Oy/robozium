import { createElement } from "react"
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TerminalLog } from "../../../../app/components/terminal/TerminalLog"

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

describe("TerminalLog", () => {
	it("preserves a scrolled-up reading position when content grows", () => {
		let notify = () => {}
		const observe = vi.fn()
		const disconnect = vi.fn()
		class ResizeObserverMock {
			constructor(callback: ResizeObserverCallback) {
				notify = () =>
					callback([], this as unknown as ResizeObserver)
			}
			observe = observe
			disconnect = disconnect
		}
		vi.stubGlobal("ResizeObserver", ResizeObserverMock)

		const { container, unmount } = render(
			createElement(
				TerminalLog,
				{ scrollable: true },
				createElement("div", null, "log entry"),
			),
		)
		const box = container.querySelector(".term-log") as HTMLDivElement
		const content = box.firstElementChild
		let scrollHeight = 100
		Object.defineProperty(box, "scrollHeight", {
			configurable: true,
			get: () => scrollHeight,
		})

		notify()
		box.scrollTop = -20
		scrollHeight = 140
		notify()

		expect(box.scrollTop).toBe(-60)
		expect(observe).toHaveBeenCalledWith(content)
		unmount()
		expect(disconnect).toHaveBeenCalledOnce()
	})
})
