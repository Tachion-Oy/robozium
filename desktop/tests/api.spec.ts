import { expect, test as base } from "@playwright/test"
import { createServer, type Server, type ServerResponse } from "node:http"
import { once } from "node:events"
import { DesktopApiClient, parseEventStream, SseFramer } from "../renderer/src/api/client"

const test = base.extend<{ backend: { client: DesktopApiClient; server: Server } }>({
	backend: async ({ baseURL }, use) => {
		void baseURL
		const server = createServer()
		server.listen(0, "127.0.0.1")
		await once(server, "listening")
		const address = server.address()
		if (!address || typeof address === "string") throw new Error("No test server port.")
		try {
			await use({ client: new DesktopApiClient(`http://127.0.0.1:${address.port}`), server })
		} finally {
			server.closeAllConnections()
			server.close()
			await once(server, "close")
		}
	},
})

test("JSON requests use the selected origin without cookies, redirects, or caching", async ({ backend: { client, server } }) => {
	server.once("request", async (request, response) => {
		expect(request.url).toBe("/projects?q=one")
		expect(request.method).toBe("POST")
		expect(request.headers["content-type"]).toBe("application/json")
		expect(request.headers.cookie).toBeUndefined()
		expect(request.headers["cache-control"]).toContain("no-cache")
		let body = ""
		for await (const chunk of request) body += chunk
		expect(JSON.parse(body)).toEqual({ name: "one" })
		response.setHeader("Content-Type", "application/json")
		response.end('{"saved":true}')
	})
	expect(await client.request("/projects?q=one", { method: "POST", json: { name: "one" } })).toEqual({ saved: true })
	for (const path of ["https://evil.example/", "//evil.example/", "http://user@127.0.0.1/"]) {
		await expect(client.request(path)).rejects.toThrow("selected backend origin")
	}
	server.once("request", (_request, response) => {
		response.writeHead(302, { Location: "https://evil.example/" })
		response.end()
	})
	await expect(client.request("/redirect")).rejects.toMatchObject({ kind: "connection" })
})

test("HTTP errors retain status and bounded safe detail", async ({ backend: { client, server } }) => {
	server.once("request", (_request, response) => {
		response.writeHead(409)
		response.end(JSON.stringify({ detail: "Try\nagain" }))
	})
	await expect(client.request("/conflict")).rejects.toMatchObject({ kind: "http", status: 409, message: "API request failed (409): Try again" })
	server.once("request", (_request, response) => {
		response.writeHead(500)
		response.end("private HTML error")
	})
	await expect(client.request("/error")).rejects.toMatchObject({ kind: "http", status: 500, message: "API request failed (500)." })
	server.once("request", (_request, response) => {
		response.writeHead(400)
		response.end(JSON.stringify({ detail: "x".repeat(238) + "\u007f\tprivate tail" }))
	})
	await expect(client.request("/bounded")).rejects.toMatchObject({
		kind: "http", status: 400, message: `API request failed (400): ${"x".repeat(238)}  `,
	})
})

test("malformed JSON, network failure, and cancellation remain distinct", async ({ backend: { client, server } }) => {
	server.once("request", (_request, response) => response.end("not JSON"))
	await expect(client.request("/invalid")).rejects.toMatchObject({ kind: "malformed" })
	server.once("request", request => request.socket.destroy())
	await expect(client.request("/closed")).rejects.toMatchObject({ kind: "connection" })
	const controller = new AbortController()
	const reached = once(server, "request")
	const pending = client.request("/slow", { signal: controller.signal })
	await reached
	controller.abort()
	await expect(pending).rejects.toMatchObject({ name: "AbortError" })
})

for (const status of [200, 500]) {
	test(`cancellation while reading an HTTP ${status} body remains an abort`, async () => {
		const controller = new AbortController()
		const body = new ReadableStream<Uint8Array>({
			pull(source) {
				controller.abort()
				source.error(controller.signal.reason)
			},
		}, { highWaterMark: 0 }) // Abort only when the client starts consuming the body.
		const nativeFetch = globalThis.fetch
		globalThis.fetch = async () => new Response(body, { status })
		try {
			const client = new DesktopApiClient("http://127.0.0.1:8000")
			await expect(client.request("/unfinished-body", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" })
		} finally {
			globalThis.fetch = nativeFetch
		}
	})
}

test("SSE framing assembles data independently of JSON and discards incomplete events", () => {
	for (const ending of ["\n", "\r", "\r\n"]) {
		const text = [": heartbeat", "event: ignored", "id: one", "", "data: first", "data:  second", "", "data", "", "data: unfinished", ""].join(ending)
		for (let boundary = 0; boundary <= text.length; boundary++) {
			const framer = new SseFramer()
			const events = [...framer.push(text.slice(0, boundary)), ...framer.push(text.slice(boundary))]
			expect(events).toEqual(["first\n second", ""])
		}
	}
})

test("SSE handles byte boundaries, CRLF/CR/LF, comments and multiline JSON", async () => {
	const bytes = new TextEncoder().encode(': heartbeat\r\nevent: ignored\r\nid: one\r\ndata: {"text":\r\ndata: "雪🚀"}\r\n\r\ndata:42\r\rdata: null\n\ndata: "unterminated"')
	for (const size of [1, 2, 7, bytes.length]) {
		let offset = 0
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (offset === bytes.length) {
					controller.close()
					return
				}
				const end = Math.min(offset + size, bytes.length)
				controller.enqueue(bytes.slice(offset, end))
				offset = end
			},
		})
		const values: unknown[] = []
		for await (const value of parseEventStream(body)) values.push(value)
		expect(values).toEqual([{ text: "雪🚀" }, 42, null])
		expect(body.locked).toBe(false)
	}
})

test("early SSE disposal cancels the source and releases its reader", async () => {
	let cancelled = 0
	const body = new ReadableStream<Uint8Array>({
		start(controller) { controller.enqueue(new TextEncoder().encode("data: 1\n\ndata: 2\n\n")) },
		cancel() { cancelled++ },
	})
	for await (const value of parseEventStream(body)) {
		expect(value).toBe(1)
		break
	}
	expect(cancelled).toBe(1)
	expect(body.locked).toBe(false)
})

test("CR dispatches an event on an open stream and skips a later optional LF", async () => {
	const controller = new AbortController()
	let source!: ReadableStreamDefaultController<Uint8Array>
	let cancelled = false
	const encode = (text: string) => new TextEncoder().encode(text)
	const body = new ReadableStream<Uint8Array>({
		start(stream) {
			source = stream
			stream.enqueue(encode("data: 1\r\r"))
		},
		cancel() { cancelled = true },
	})
	const events = parseEventStream(body, controller.signal)
	const deadline = setTimeout(() => controller.abort(), 1000)
	try {
		// Neither close the source nor send another chunk until this event arrives.
		expect(await events.next()).toEqual({ value: 1, done: false })
		source.enqueue(encode('\ndata: {"text":\r'))
		source.enqueue(encode('\ndata: "ok"}\r\r'))
		expect(await events.next()).toEqual({ value: { text: "ok" }, done: false })
	} finally {
		clearTimeout(deadline)
		controller.abort()
		await events.return(undefined)
	}
	expect(cancelled).toBe(true)
	expect(body.locked).toBe(false)
})

test("abort interrupts a pending stream read and releases the reader", async () => {
	let cancelled = 0
	const body = new ReadableStream<Uint8Array>({ cancel() { cancelled++ } })
	const controller = new AbortController()
	const iterator = parseEventStream(body, controller.signal)
	const pending = iterator.next()
	controller.abort()
	await expect(pending).rejects.toMatchObject({ name: "AbortError" })
	expect(cancelled).toBe(1)
	expect(body.locked).toBe(false)
})

test("malformed frames and stream errors reach the caller and release readers", async () => {
	for (const payload of ["data: invalid\n\n", "data\n\n"]) {
		let cancelled = false
		const body = new ReadableStream<Uint8Array>({
			start(controller) { controller.enqueue(new TextEncoder().encode(payload)) },
			cancel() { cancelled = true },
		})
		await expect(parseEventStream(body).next()).rejects.toMatchObject({ kind: "malformed" })
		expect(cancelled).toBe(true)
		expect(body.locked).toBe(false)
	}
	const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("lost connection")) } })
	await expect(parseEventStream(body).next()).rejects.toMatchObject({ kind: "connection" })
	expect(body.locked).toBe(false)
	const invalidUtf8 = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([255])) } })
	await expect(parseEventStream(invalidUtf8).next()).rejects.toMatchObject({ kind: "malformed" })
	expect(invalidUtf8.locked).toBe(false)
})

test("HTTP event subscription cancels the response on early exit and abort", async ({ backend: { client, server } }) => {
	for (const abort of [false, true]) {
		let response: ServerResponse | undefined
		server.once("request", (request, res) => {
			expect(request.url).toBe("/run/run%2Fone/stream")
			expect(request.headers.accept).toBe("text/event-stream")
			response = res
			res.writeHead(200, { "Content-Type": "text/event-stream" })
			res.write("data: {\"type\":\"test\"}\n\n")
		})
		const controller = new AbortController()
		const events = client.streamRunEvents("run/one", controller.signal)
		expect((await events.next()).value).toEqual({ type: "test" })
		const closed = once(response!, "close")
		if (abort) {
			const pending = events.next()
			controller.abort()
			await expect(pending).rejects.toMatchObject({ name: "AbortError" })
		} else {
			await events.return(undefined)
		}
		await closed
	}
})

test("event subscription rejects a non-stream response", async ({ backend: { client, server } }) => {
	server.once("request", (_request, response) => {
		response.setHeader("Content-Type", "application/json")
		response.end("{}")
	})
	await expect(client.streamRunEvents("one").next()).rejects.toMatchObject({ kind: "malformed" })
})
