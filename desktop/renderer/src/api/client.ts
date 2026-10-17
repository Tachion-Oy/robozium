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

function safeErrorDetail(body: unknown): string {
	if (!body || typeof body !== "object" || !("detail" in body) || typeof body.detail !== "string") return ""
	return Array.from(body.detail.slice(0, 240), char => char < " " || char === "\u007f" ? " " : char).join("")
}

async function httpError(response: Response, signal?: AbortSignal | null): Promise<ApiError> {
	let detail = ""
	try {
		detail = safeErrorDetail(await response.json())
	} catch {
		// An unreadable error body still has a useful HTTP status; cancellation wins.
		signal?.throwIfAborted()
	}
	signal?.throwIfAborted()
	const description = detail ? `: ${detail}` : "."
	return new ApiError("http", `API request failed (${response.status})${description}`, response.status)
}

export class DesktopApiClient {
	private readonly base: URL

	constructor(baseUrl: string) {
		this.base = new URL(baseUrl)
		if (this.base.protocol !== "http:" || this.base.hostname !== "127.0.0.1"
			|| this.base.username || this.base.password || this.base.pathname !== "/"
			|| this.base.search || this.base.hash) {
			throw new TypeError("Invalid backend address.")
		}
	}

	private async sendRequest(path: string, options: RequestInit): Promise<Response> {
		const url = new URL(path, this.base)
		if (url.origin !== this.base.origin || url.username || url.password) {
			throw new TypeError("API requests must use the selected backend origin.")
		}
		let response: Response
		try {
			response = await globalThis.fetch(url, { ...options, credentials: "omit", cache: "no-store", redirect: "error" })
		} catch {
			options.signal?.throwIfAborted()
			throw new ApiError("connection", "Could not reach the backend.")
		}
		if (!response.ok) throw await httpError(response, options.signal)
		return response
	}

	async request(path: string, options: JsonRequest = {}): Promise<unknown> {
		const response = await this.sendRequest(path, {
			method: options.method ?? "GET",
			signal: options.signal,
			headers: { Accept: "application/json", ...(options.json === undefined ? {} : { "Content-Type": "application/json" }) },
			body: options.json === undefined ? undefined : JSON.stringify(options.json),
		})
		let text: string
		try {
			text = await response.text()
		} catch {
			options.signal?.throwIfAborted()
			throw new ApiError("connection", "The backend response was interrupted.")
		}
		options.signal?.throwIfAborted()
		try {
			return JSON.parse(text) as unknown
		} catch {
			throw new ApiError("malformed", "The backend returned invalid JSON.")
		}
	}

	async *streamRunEvents(runId: string, signal?: AbortSignal): AsyncGenerator<unknown> {
		const response = await this.sendRequest(`/run/${encodeURIComponent(runId)}/stream`, {
			headers: { Accept: "text/event-stream" }, signal,
		})
		if (!response.body || response.headers.get("Content-Type")?.split(";", 1)[0].trim() !== "text/event-stream") {
			await response.body?.cancel()
			throw new ApiError("malformed", "The backend did not return an event stream.")
		}
		yield* parseEventStream(response.body, signal)
	}
}

/** Assemble SSE data fields from decoded text; incomplete events stay buffered. */
export class SseFramer {
	private pendingText = ""
	private dataLines: string[] = []
	private skipLf = false

	push(text: string): string[] {
		this.pendingText += text
		const events: string[] = []
		for (;;) {
			if (!this.pendingText.length) return events
			if (this.skipLf) {
				if (this.pendingText[0] === "\n") this.pendingText = this.pendingText.slice(1)
				this.skipLf = false
			}
			const lineEnd = this.pendingText.search(/[\r\n]/)
			if (lineEnd < 0) return events
			const line = this.pendingText.slice(0, lineEnd)
			// CR ends the line now; consume an optional LF even if it arrives next time.
			this.skipLf = this.pendingText[lineEnd] === "\r"
			this.pendingText = this.pendingText.slice(lineEnd + 1)
			if (line === "") {
				if (this.dataLines.length) events.push(this.dataLines.join("\n"))
				this.dataLines = []
			} else if (line === "data" || line.startsWith("data:")) {
				this.dataLines.push(line.slice(5).replace(/^ /, ""))
			}
		}
	}
}

function decodeEventText(decoder: TextDecoder, bytes?: Uint8Array): string {
	try {
		return bytes === undefined ? decoder.decode() : decoder.decode(bytes, { stream: true })
	} catch {
		throw new ApiError("malformed", "The backend returned invalid event text.")
	}
}

function parseEventData(data: string): unknown {
	try {
		return JSON.parse(data) as unknown
	} catch {
		throw new ApiError("malformed", "The backend returned an invalid event.")
	}
}

// Adapted from web/lib/robozium/sse.ts at 8343b8e: retain streaming UTF-8 and
// reader ownership; support SSE line endings/multiline data without run schemas.
export async function* parseEventStream(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<unknown> {
	const reader = body.getReader()
	const decoder = new TextDecoder("utf-8", { fatal: true })
	const framer = new SseFramer()
	const cancel = async () => {
		try {
			await reader.cancel()
		} catch {
			// Preserve the original stream error.
		}
	}
	const abort = () => { void cancel() }
	signal?.addEventListener("abort", abort, { once: true })
	try {
		for (;;) {
			signal?.throwIfAborted()
			const { done, value } = await reader.read()
			signal?.throwIfAborted()
			const text = decodeEventText(decoder, done ? undefined : value)
			for (const data of framer.push(text)) {
				yield parseEventData(data)
				signal?.throwIfAborted()
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
