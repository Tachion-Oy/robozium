export class ApiError extends Error {
	constructor(readonly kind: "http" | "malformed" | "connection", message: string, readonly status?: number) {
		super(message)
		this.name = "ApiError"
	}
}

interface JsonRequest {
	method?: "GET" | "POST" | "DELETE"
	json?: unknown
	signal?: AbortSignal
}

export class DesktopApiClient {
	private readonly base: URL

	constructor(baseUrl: string) {
		this.base = new URL(baseUrl)
		if (this.base.protocol !== "http:" || this.base.hostname !== "127.0.0.1"
			|| this.base.username || this.base.password || this.base.pathname !== "/"
			|| this.base.search || this.base.hash) throw new TypeError("Invalid backend address.")
	}

	private async fetch(path: string, options: RequestInit): Promise<Response> {
		const url = new URL(path, this.base)
		if (url.origin !== this.base.origin || url.username || url.password) {
			throw new TypeError("API requests must use the selected backend origin.")
		}
		try {
			const response = await fetch(url, { ...options, credentials: "omit", cache: "no-store", redirect: "error" })
			if (!response.ok) {
				let detail = ""
				try {
					const body: unknown = await response.json()
					if (body && typeof body === "object" && "detail" in body && typeof body.detail === "string") {
						detail = Array.from(body.detail.slice(0, 240), char => char < " " || char === "\u007f" ? " " : char).join("")
					}
				} catch { options.signal?.throwIfAborted() }
				throw new ApiError("http", `API request failed (${response.status})${detail ? `: ${detail}` : "."}`, response.status)
			}
			return response
		} catch (error) {
			options.signal?.throwIfAborted()
			if (error instanceof ApiError) throw error
			throw new ApiError("connection", "Could not reach the backend.")
		}
	}

	async request(path: string, options: JsonRequest = {}): Promise<unknown> {
		const response = await this.fetch(path, {
			method: options.method ?? "GET", signal: options.signal,
			headers: { Accept: "application/json", ...(options.json === undefined ? {} : { "Content-Type": "application/json" }) },
			body: options.json === undefined ? undefined : JSON.stringify(options.json),
		})
		let text: string
		try { text = await response.text() }
		catch {
			options.signal?.throwIfAborted()
			throw new ApiError("connection", "The backend response was interrupted.")
		}
		options.signal?.throwIfAborted()
		try { return JSON.parse(text) as unknown }
		catch { throw new ApiError("malformed", "The backend returned invalid JSON.") }
	}

	async *streamRunEvents(runId: string, signal?: AbortSignal): AsyncGenerator<unknown> {
		const response = await this.fetch(`/run/${encodeURIComponent(runId)}/stream`, {
			headers: { Accept: "text/event-stream" }, signal,
		})
		if (!response.body || response.headers.get("Content-Type")?.split(";", 1)[0].trim() !== "text/event-stream") {
			await response.body?.cancel()
			throw new ApiError("malformed", "The backend did not return an event stream.")
		}
		yield* parseEventStream(response.body, signal)
	}
}

// Adapted from web/lib/robozium/sse.ts at 8343b8e: retain streaming UTF-8 and
// reader ownership; support SSE line endings/multiline data without run schemas.
export async function* parseEventStream(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<unknown> {
	const reader = body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true })
	let buffer = "", data: string[] = []
	const cancel = async () => {
		try { await reader.cancel() } catch { /* Preserve the original stream error. */ }
	}
	const abort = () => { void cancel() }
	signal?.addEventListener("abort", abort, { once: true })
	try {
		for (;;) {
			signal?.throwIfAborted()
			const { done, value } = await reader.read()
			signal?.throwIfAborted()
			try { buffer += done ? decoder.decode() : decoder.decode(value, { stream: true }) }
			catch { throw new ApiError("malformed", "The backend returned invalid event text.") }
			for (;;) {
				const index = buffer.search(/[\r\n]/)
				if (index < 0 || (!done && index === buffer.length - 1 && buffer[index] === "\r")) break
				const line = buffer.slice(0, index)
				buffer = buffer.slice(index + (buffer.slice(index, index + 2) === "\r\n" ? 2 : 1))
				if (line === "") {
					if (data.length) {
						let parsed: unknown
						try { parsed = JSON.parse(data.join("\n")) as unknown }
						catch { throw new ApiError("malformed", "The backend returned an invalid event.") }
						data = []
						yield parsed
						signal?.throwIfAborted()
					}
				} else if (line === "data" || line.startsWith("data:")) {
					data.push(line.slice(5).replace(/^ /, ""))
				}
			}
			if (done) return // SSE discards unterminated events at EOF.
		}
	} catch (error) {
		signal?.throwIfAborted()
		if (error instanceof ApiError) throw error
		throw new ApiError("connection", "The backend event stream was interrupted.")
	} finally {
		signal?.removeEventListener("abort", abort)
		await cancel()
		reader.releaseLock()
	}
}
