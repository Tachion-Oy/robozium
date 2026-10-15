// @vitest-environment node
import { expect, it, vi } from "vitest"
import { readBoundedBody } from "@/lib/robozium/http"
vi.mock("@/lib/robozium/config", () => ({ ROBOZIUM_API_BASE_URL: "http://backend" }))

function requestWith(body: ReadableStream<Uint8Array>) {
	const init: RequestInit & { duplex: "half" } = { method: "POST", body, duplex: "half" }
	return new Request("http://next.test/upload", init)
}

it("reads chunks up to the limit and releases the reader", async () => {
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new Uint8Array([1, 2]))
			controller.enqueue(new Uint8Array([3]))
			controller.close()
		},
	})
	expect(await readBoundedBody(requestWith(stream), 3, "Too large")).toEqual(new Uint8Array([1, 2, 3]))
	expect(stream.locked).toBe(false)
})

it("cancels oversized streams and releases the reader", async () => {
	const cancel = vi.fn()
	const stream = new ReadableStream<Uint8Array>({
		start(controller) { controller.enqueue(new Uint8Array(4)) }, cancel,
	})
	const result = await readBoundedBody(requestWith(stream), 3, "Too large")
	expect(result).toBeInstanceOf(Response)
	expect((result as Response).status).toBe(413)
	expect(cancel).toHaveBeenCalledOnce()
	expect(stream.locked).toBe(false)
})

it("reports interrupted uploads and releases the reader", async () => {
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) { controller.error(new Error("connection lost")) },
	})
	const result = await readBoundedBody(requestWith(stream), 3, "Too large")
	expect(result).toBeInstanceOf(Response)
	expect((result as Response).status).toBe(400)
	expect(stream.locked).toBe(false)
})
