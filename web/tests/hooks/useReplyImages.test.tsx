import { StrictMode } from "react"
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useReplyImages } from "../../hooks/useReplyImages"
import { AgentApiError } from "../../lib/robozium/client"
import { deferred, mockImageTransport } from "../reply-image-transport"

let transport: ReturnType<typeof mockImageTransport>
const file = (name = "one.png") => new File(["image"], name, { type: "image/png" })
beforeEach(() => {
	transport = mockImageTransport()
	let nextUrl = 0
	vi.stubGlobal("URL", class extends URL {
		static createObjectURL = vi.fn(() => `blob:${++nextUrl}`)
		static revokeObjectURL = vi.fn()
	})
})
afterEach(() => { vi.unstubAllGlobals() })

async function ready() {
	const view = renderHook(() => useReplyImages("one"), { wrapper: StrictMode })
	await waitFor(() => expect(view.result.current.isReady).toBe(true))
	return view
}

describe("useReplyImages", () => {
	it("uploads in order, consumes an accepted image-only reply, and keeps subsequent additions", async () => {
		const { result, unmount } = await ready()
		act(() => result.current.onDrop([file(), file("two.png")], []))
		expect(result.current.isReady).toBe(false)
		await waitFor(() => expect(result.current.isReady).toBe(true))
		expect(transport.pending.get("one")?.map(({ name }) => name)).toEqual(["one.png", "two.png"])
		const reply = deferred<boolean>()
		const send = vi.fn(() => reply.promise)
		let submitted!: Promise<boolean>
		act(() => { submitted = result.current.submit(send) })
		expect(send).toHaveBeenCalledWith(true)
		act(() => result.current.onDrop([file("next.png")], []))
		await act(async () => { transport.pending.set("one", []); reply.resolve(true); await submitted })
		await waitFor(() => expect(result.current.isReady).toBe(true))
		expect(result.current.images.map(({ name }) => name)).toEqual(["next.png"])
		expect(transport.pending.get("one")?.map(({ name }) => name)).toEqual(["next.png"])
		unmount()
		expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3)
	})

	it.each(["remove", "clear"])("%s waits for an active upload, cancels queued uploads, and cannot revive previews", async (action) => {
		const { result } = await ready()
		const gate = deferred<void>()
		transport.fetchMock.mockImplementationOnce(async (input, init) => { await gate.promise; return transport.handle(input, init) })
		act(() => result.current.onDrop([file(), file("queued.png")], []))
		act(() => {
			if (action === "clear") result.current.onClear()
			else result.current.images.forEach(({ url }) => result.current.onRemove(url))
		})
		expect(result.current.images).toEqual([])
		expect(result.current.isBusy).toBe(true)
		expect(transport.fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(0)
		await act(async () => { gate.resolve(); await gate.promise })
		await waitFor(() => expect(result.current.isReady).toBe(true))
		expect(result.current.images).toEqual([])
		expect(transport.pending.get("one")).toEqual([])
		expect(transport.fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1)
	})

	it("restores server previews on refresh without uploading them again", async () => {
		const first = await ready()
		act(() => first.result.current.onDrop([file()], []))
		await waitFor(() => expect(first.result.current.isReady).toBe(true))
		first.unmount()
		const next = await ready()
		expect(next.result.current.images[0]).toMatchObject({ serverId: "1", url: "/api/files/projects/one/1.png", status: "ready" })
		expect(transport.fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1)
	})

	it("places restored attachments before files added during the pending refresh", async () => {
		const stored = { id: "stored", name: "stored.png", path: "projects/one/stored.png" }
		transport.pending.set("one", [stored])
		const gate = deferred<Response>()
		transport.fetchMock.mockReturnValueOnce(gate.promise)
		const { result } = renderHook(() => useReplyImages("one"))
		act(() => result.current.onDrop([file("new.png")], []))
		expect(result.current.images.map(({ name }) => name)).toEqual(["new.png"])
		await act(async () => { gate.resolve(Response.json([stored])); await gate.promise })
		await waitFor(() => expect(result.current.isReady).toBe(true))
		expect(result.current.images.map(({ name }) => name)).toEqual(["stored.png", "new.png"])
		expect(transport.pending.get("one")?.map(({ name }) => name)).toEqual(["stored.png", "new.png"])
	})

	it("waits for an in-flight upload when reopening its run and restores the preview", async () => {
		const { result, rerender } = renderHook(({ runId }) => useReplyImages(runId), { initialProps: { runId: "one" } })
		await waitFor(() => expect(result.current.isReady).toBe(true))
		const gate = deferred<void>()
		transport.fetchMock.mockImplementationOnce(async (input, init) => { await gate.promise; return transport.handle(input, init) })
		act(() => result.current.onDrop([file()], []))
		rerender({ runId: "two" })
		await waitFor(() => expect(result.current.isReady).toBe(true))
		rerender({ runId: "one" })
		expect(result.current.isReady).toBe(false)
		const send = vi.fn()
		expect(await result.current.submit(send)).toBe(false)
		expect(send).not.toHaveBeenCalled()
		await act(async () => { gate.resolve(); await gate.promise })
		await waitFor(() => expect(result.current.isReady).toBe(true))
		expect(result.current.images).toMatchObject([{ name: "one.png", serverId: "1", status: "ready" }])
		expect(transport.pending.get("one")).toHaveLength(1)
	})

	it("retries with the same upload identity when the original request has not committed yet", async () => {
		const { result } = await ready()
		let original!: Parameters<typeof fetch>
		transport.fetchMock.mockImplementationOnce(async (input, init) => {
			original = [input, init]
			throw new TypeError("Failed to fetch")
		})
		act(() => result.current.onDrop([file()], []))
		await waitFor(() => expect(result.current.canRetry).toBe(true))
		expect(transport.pending.get("one") ?? []).toEqual([])
		act(() => result.current.onRetry())
		await waitFor(() => expect(result.current.isReady).toBe(true))
		await act(async () => { await transport.handle(...original) })
		expect(transport.pending.get("one")).toHaveLength(1)
		expect(result.current.images).toHaveLength(1)
		const requests = transport.fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")
		expect(requests).toHaveLength(2)
		expect(requests[0][0]).toBe(requests[1][0])
	})

	it("preserves rejected replies and reconciles a lost upload acknowledgement before retry", async () => {
		const { result } = await ready()
		transport.fetchMock.mockImplementationOnce(async (input, init) => {
			await transport.handle(input, init)
			throw new Error("connection lost")
		})
		act(() => result.current.onDrop([file()], []))
		await waitFor(() => expect(result.current.canRetry).toBe(true))
		expect(result.current.images[0].status).toBe("failed")
		act(() => result.current.onRetry())
		await waitFor(() => expect(result.current.isReady).toBe(true))
		expect(transport.pending.get("one")).toHaveLength(1)
		expect(transport.fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1)
		await act(async () => {
			await expect(result.current.submit(async () => { throw new AgentApiError(400, "stale prompt") })).rejects.toThrow("stale prompt")
		})
		expect(result.current.images).toHaveLength(1)
		expect(result.current.isReady).toBe(true)
	})

	it.each(["remove", "clear"])("keeps a retryable draft after failed %s", async (action) => {
		const { result } = await ready()
		act(() => result.current.onDrop([file()], []))
		await waitFor(() => expect(result.current.isReady).toBe(true))
		transport.fetchMock.mockResolvedValueOnce(Response.json({ detail: "storage unavailable" }, { status: 500 }))
		act(() => { if (action === "clear") result.current.onClear(); else result.current.onRemove(result.current.images[0].url) })
		await waitFor(() => expect(result.current.canRetry).toBe(true))
		expect(result.current.images).toHaveLength(1)
		expect(result.current.error).toContain("storage unavailable")
		act(() => result.current.onRetry())
		await waitFor(() => expect(result.current.isReady).toBe(true))
		expect(result.current.images).toEqual([])
		expect(transport.pending.get("one")).toEqual([])
	})

	it("keeps failed upload bytes and batch order for explicit retry and blocks send until resolved", async () => {
		const { result } = await ready()
		transport.fetchMock.mockResolvedValueOnce(Response.json({ detail: "image limit" }, { status: 400 }))
		act(() => result.current.onDrop([file(), file("second.png")], []))
		await waitFor(() => expect(result.current.canRetry).toBe(true))
		expect(transport.fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1)
		const send = vi.fn()
		expect(await result.current.submit(send)).toBe(false)
		expect(send).not.toHaveBeenCalled()
		act(() => result.current.onRetry())
		await waitFor(() => expect(result.current.isReady).toBe(true))
		expect(transport.pending.get("one")?.map(({ name }) => name)).toEqual(["one.png", "second.png"])
	})

	it("disposes old runs and terminal drafts without deleting server files or applying late reads", async () => {
		const gate = deferred<Response>()
		transport.fetchMock.mockReturnValueOnce(gate.promise)
		const { result, rerender } = renderHook(({ runId, ended }) => useReplyImages(runId, ended), { initialProps: { runId: "one", ended: false } })
		const oldDrop = result.current.onDrop
		rerender({ runId: "two", ended: false })
		await waitFor(() => expect(result.current.isReady).toBe(true))
		await act(async () => { gate.resolve(Response.json([{ id: "old", name: "old", path: "old.png" }])); await gate.promise })
		act(() => oldDrop([file()], []))
		expect(result.current.images).toEqual([])
		act(() => result.current.onDrop([file()], []))
		await waitFor(() => expect(result.current.isReady).toBe(true))
		rerender({ runId: "two", ended: true })
		expect(result.current.images).toEqual([])
		expect(result.current.canAdd).toBe(false)
		expect(transport.pending.get("two")).toHaveLength(1)
	})

	it("enforces the total limit for additions before rendering", async () => {
		const { result } = await ready()
		act(() => { for (let i = 0; i < 5; i += 1) result.current.onDrop([file(`${i}.png`)], []) })
		expect(result.current.images).toHaveLength(4)
		expect(result.current.error).toContain("up to four images")
		await waitFor(() => expect(result.current.isReady).toBe(true))
	})

	it("ignores a late submission acknowledgement after changing runs", async () => {
		const { result, rerender } = renderHook(({ runId }) => useReplyImages(runId), { initialProps: { runId: "one" } })
		await waitFor(() => expect(result.current.isReady).toBe(true))
		const reply = deferred<boolean>()
		let submitted!: Promise<boolean>
		act(() => { submitted = result.current.submit(() => reply.promise) })
		rerender({ runId: "two" })
		await waitFor(() => expect(result.current.isReady).toBe(true))
		await act(async () => { reply.resolve(true); expect(await submitted).toBe(false) })
		expect(result.current.images).toEqual([])
	})

	it("reconciles accepted images after a lost reply acknowledgement without uploading or submitting again", async () => {
		const { result } = await ready()
		act(() => result.current.onDrop([file()], []))
		await waitFor(() => expect(result.current.isReady).toBe(true))
		const send = vi.fn(async () => { transport.pending.set("one", []); throw new Error("offline") })
		await act(async () => { await expect(result.current.submit(send)).rejects.toThrow("offline") })
		expect(result.current.images).toHaveLength(1)
		expect(result.current.isReady).toBe(false)
		act(() => result.current.onRetry())
		await waitFor(() => expect(result.current.isReady).toBe(true))
		expect(result.current.images).toEqual([])
		expect(send).toHaveBeenCalledTimes(1)
		expect(transport.fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1)
	})
})
