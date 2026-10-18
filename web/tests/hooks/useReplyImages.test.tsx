import { StrictMode } from "react"
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useReplyImages } from "../../hooks/useReplyImages"

beforeEach(() => {
	let nextUrl = 0
	vi.stubGlobal("URL", class extends URL {
		static createObjectURL = vi.fn(() => `blob:${++nextUrl}`)
		static revokeObjectURL = vi.fn()
	})
})
afterEach(() => { vi.unstubAllGlobals() })

describe("useReplyImages", () => {
	it("keeps repeated additions ordered and cleans only discarded URLs", () => {
		const { result, unmount } = renderHook(() => useReplyImages("one"), { wrapper: StrictMode })
		act(() => {
			result.current.onDrop([new File(["1"], "one.png")], [])
			result.current.onDrop([new File(["2"], "two.png")], [])
		})
		expect(result.current.images.map(({ name }) => name)).toEqual(["one.png", "two.png"])
		expect(URL.revokeObjectURL).not.toHaveBeenCalled()
		act(() => result.current.onRemove("blob:1"))
		expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:1")
		unmount()
		expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
		expect(URL.revokeObjectURL).toHaveBeenLastCalledWith("blob:2")
	})

	it("disposes the previous run draft and ignores its late additions", () => {
		const { result, rerender, unmount } = renderHook(({ runId }) => useReplyImages(runId), { initialProps: { runId: "one" } })
		const oldDrop = result.current.onDrop
		act(() => oldDrop([new File(["1"], "one.png")], []))
		rerender({ runId: "two" })
		expect(result.current.images).toHaveLength(0)
		expect(result.current.error).toBeNull()
		expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:1")
		act(() => oldDrop([new File(["2"], "late.png")], []))
		expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
		const drop = result.current.onDrop
		unmount()
		drop([new File(["3"], "later.png")], [])
		expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
	})

	it("enforces the total limit even for additions queued before rendering", () => {
		const { result } = renderHook(() => useReplyImages("one"))
		act(() => {
			for (let i = 0; i < 5; i += 1) result.current.onDrop([new File(["1"], `${i}.png`)], [])
		})
		expect(result.current.images).toHaveLength(4)
		expect(result.current.error).toContain("up to four images")
		expect(URL.createObjectURL).toHaveBeenCalledTimes(4)
		act(() => result.current.onClear())
		expect(result.current.images).toHaveLength(0)
		expect(result.current.error).toBeNull()
		expect(URL.revokeObjectURL).toHaveBeenCalledTimes(4)
	})
})
