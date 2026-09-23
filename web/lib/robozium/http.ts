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
