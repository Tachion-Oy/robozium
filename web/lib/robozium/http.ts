import { ROBOZIUM_API_BASE_URL } from "./config"
import { slog, swarn } from "./log"

type FetchAgentUpstreamOptions = {
	/**
	 * Omitted when calling from a Server Component page render (no incoming
	 * Request to wire an abort signal to) rather than a route handler.
	 */
	request?: Request
	path: string
	init?: RequestInit
}

// Endpoints the client polls every few seconds (run/list status). Their trace
// would drown the useful lifecycle logs, so we skip the per-request trace for
// them — anomalies (swarn/serror) still fire. Mirrors the uvicorn access-log
// filter (`_POLLING_PATHS`) in api/app.py. Note `/run/<id>/stream` and
// `/run/<id>/reply` are intentionally NOT matched, so those stay traced.
const POLLING_PATHS = [/^\/projects$/, /^\/run\/[^/]+$/]

export function isPollingPath(method: string, path: string): boolean {
	if (method.toUpperCase() !== "GET") return false
	const clean = (path.split("?")[0] ?? path).replace(/\/+$/, "") || "/"
	return POLLING_PATHS.some((pattern) => pattern.test(clean))
}

/**
 * Low-level server helper for route handlers (and Server Component page
 * renders) that talk to the hub. Keeps transport concerns (base URL, abort
 * wiring, network error mapping) in one place so callers only deal with
 * endpoint-specific logic. `request` is omitted for page-render seed fetches,
 * which have no incoming Request to wire an abort signal to.
 */
export async function fetchAgentUpstream({
	request,
	path,
	init,
}: FetchAgentUpstreamOptions): Promise<Response> {
	const upstreamUrl = `${ROBOZIUM_API_BASE_URL}${path}`
	const method = init?.method ?? "GET"
	const quiet = isPollingPath(method, path)
	if (!quiet) slog("bff", `→ ${method} ${path}`)
	try {
		const upstream = await fetch(upstreamUrl, {
			...init,
			signal: request?.signal,
			cache: "no-store",
		})
		if (!quiet) slog("bff", `← ${method} ${path} ${upstream.status}`)
		return upstream
	} catch (err) {
		if (request?.signal.aborted) {
			// Client went away mid-request (e.g. stream abort / navigation).
			// Routine, but the key server-side signal for an interrupted stream.
			slog("bff", `aborted ${method} ${path} → 499 (client disconnect)`)
			return new Response(null, { status: 499 })
		}
		swarn("bff", `upstream unreachable ${method} ${path} → 502`, err)
		const detail =
			err instanceof Error ? err.message : "upstream unreachable"
		return Response.json({ detail }, { status: 502 })
	}
}

/**
 * Server-side seed fetch for pages that pre-render with hub data, reusing the
 * same proxy path route handlers use (shared logging/error handling) instead
 * of a second hand-rolled fetch. Failures return null: the client
 * session/poller fetches the same data anyway, so a missing seed only costs
 * the head start.
 */
export async function fetchSeed<T>(path: string): Promise<T | null> {
	const upstream = await fetchAgentUpstream({
		path,
		init: { headers: { Accept: "application/json" } },
	})
	if (!upstream.ok) return null
	return (await upstream.json()) as T
}

/**
 * Forward response body/status with a predictable content-type fallback.
 */
export function passthroughResponse(
	upstream: Response,
	fallbackContentType = "application/json",
): Response {
	const headers = new Headers(upstream.headers)
	if (!headers.has("Content-Type")) {
		headers.set("Content-Type", fallbackContentType)
	}
	return new Response(upstream.body, {
		status: upstream.status,
		headers,
	})
}

export async function proxyEnvironmentRequest(request: Request, path: "/credentials/environment" | "/credentials/environment/import" | `/credentials/environment/imports/${string}`) {
	const origin = request.headers.get("origin")
	let sameOrigin = !origin
	try { sameOrigin = !origin || new URL(origin).host === request.headers.get("host") } catch { /* Reject malformed origins. */ }
	if (!sameOrigin) return Response.json({ detail: "Cross-origin configuration changes are not allowed" }, { status: 403 })
	const reader = request.method === "DELETE" ? undefined : request.body?.getReader()
	if (!reader && request.method !== "DELETE") return Response.json({ detail: "Missing request" }, { status: 400 })
	const limit = path.endsWith("/import") ? 32 * 1024 * 1024 : 256 * 1024
	const chunks: Uint8Array[] = []
	let length = 0
	while (reader) {
		const { done, value } = await reader.read()
		if (done) break
		length += value.length
		if (length > limit) {
			await reader.cancel()
			return Response.json({ detail: "Environment request is too large" }, { status: 413 })
		}
		chunks.push(value)
	}
	const body = new Uint8Array(length)
	let offset = 0
	for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length }
	const response = passthroughResponse(await fetchAgentUpstream({
		request, path, init: {
			method: request.method,
			headers: { "Content-Type": request.headers.get("content-type") ?? "" },
			body: request.method === "DELETE" ? undefined : body,
		},
	}))
	response.headers.set("Cache-Control", "no-store")
	return response
}
