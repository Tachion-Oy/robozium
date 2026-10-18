import { vi } from "vitest"
import type { RunAttachment } from "../lib/robozium/wire"

/** A controlled HTTP boundary; the real client and draft queue run in tests. */
export function mockImageTransport() {
	const pending = new Map<string, RunAttachment[]>()
	const uploads = new Map<string, RunAttachment>()
	let nextId = 0
	const handle: typeof fetch = async (input, init) => {
		const url = new URL(String(input), "http://test")
		const match = /^\/api\/runs\/([^/]+)\/files(?:\/([^/]+))?$/.exec(url.pathname)
		if (!match) throw new Error(`Unexpected request ${url}`)
		const runId = decodeURIComponent(match[1])
		const items = pending.get(runId) ?? []
		switch (init?.method ?? "GET") {
			case "GET": return Response.json(items)
			case "POST": {
				const uploadId = url.searchParams.get("upload_id")
				const key = `${runId}/${uploadId}`
				const previous = uploadId ? uploads.get(key) : undefined
				if (previous) return items.includes(previous) ? Response.json(previous) : Response.json({ detail: "Upload has already been submitted or removed" }, { status: 400 })
				const file = init?.body as File
				const item = { id: String(++nextId), name: file.name, path: `projects/${runId}/${nextId}.png`, upload_id: uploadId }
				pending.set(runId, [...items, item])
				if (uploadId) uploads.set(key, item)
				return Response.json(item)
			}
			case "DELETE":
				pending.set(runId, match[2] ? items.filter((item) => item.id !== decodeURIComponent(match[2])) : [])
				return new Response(null, { status: 204 })
			default: throw new Error(`Unexpected method ${init?.method}`)
		}
	}
	const fetchMock = vi.fn(handle)
	vi.stubGlobal("fetch", fetchMock)
	return { pending, fetchMock, handle }
}

export function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (reason: unknown) => void
	const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline })
	return { promise, resolve, reject }
}
