import { act, cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { IntroStream } from "../../../../app/components/terminal/demo/DemoLog"

let animationFrameId = 0
let animationFrames = new Map<number, FrameRequestCallback>()

function renderIntro(onIntroDone = vi.fn()) {
	const view = render(<IntroStream onIntroDone={onIntroDone} />)
	return { ...view, onIntroDone }
}

function runNextFrame(timestamp: number): FrameRequestCallback {
	const next = animationFrames.entries().next().value as
		| [number, FrameRequestCallback]
		| undefined
	if (!next) throw new Error("No animation frame was scheduled")
	const [id, callback] = next
	animationFrames.delete(id)
	act(() => callback(timestamp))
	return callback
}

beforeEach(() => {
	vi.useFakeTimers()
	animationFrameId = 0
	animationFrames = new Map()
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn((callback: FrameRequestCallback) => {
			animationFrameId += 1
			animationFrames.set(animationFrameId, callback)
			return animationFrameId
		}),
	)
	vi.stubGlobal(
		"cancelAnimationFrame",
		vi.fn((id: number) => animationFrames.delete(id)),
	)
	vi.spyOn(performance, "now").mockReturnValue(0)
})

afterEach(() => {
	cleanup()
	vi.useRealTimers()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe("IntroStream cascade", () => {
	it("launches rows 85ms apart with alternating reveal directions", () => {
		renderIntro()
		let carets = document.querySelectorAll(".term-caret--reveal")
		expect(carets).toHaveLength(1)
		expect(carets[0]?.classList.contains("term-caret--reveal-reversed")).toBe(
			false,
		)

		runNextFrame(84)
		expect(document.querySelectorAll(".term-caret--reveal")).toHaveLength(1)

		runNextFrame(85)
		carets = document.querySelectorAll(".term-caret--reveal")
		expect(carets).toHaveLength(2)
		expect(carets[1]?.classList.contains("term-caret--reveal-reversed")).toBe(
			true,
		)
	})

	it("fires completion once after the unchanged 1600ms HUD pause", () => {
		const { onIntroDone } = renderIntro()
		const completedFrame = runNextFrame(100_000)

		act(() => vi.advanceTimersByTime(1599))
		expect(onIntroDone).not.toHaveBeenCalled()
		act(() => vi.advanceTimersByTime(1))
		expect(onIntroDone).toHaveBeenCalledTimes(1)

		act(() => completedFrame(100_016))
		act(() => vi.advanceTimersByTime(10_000))
		expect(onIntroDone).toHaveBeenCalledTimes(1)
	})
})
