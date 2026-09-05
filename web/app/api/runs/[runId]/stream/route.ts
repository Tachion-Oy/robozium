import { fetchAgentUpstream, passthroughResponse } from "@/lib/robosprawl/http"
import { slog, swarn } from "@/lib/robosprawl/log"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SSE_HEADERS = {
	"Content-Type": "text/event-stream",
	"Cache-Control": "no-cache, no-transform",
	Connection: "keep-alive",
	"X-Accel-Buffering": "no",
} as const

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ runId: string }> },
) {
	const { runId } = await params
	slog("bff", `stream proxy open runId=${runId}`)
	const upstream = await fetchAgentUpstream({
		request,
		path: `/run/${encodeURIComponent(runId)}/stream`,
		init: {
			headers: { Accept: "text/event-stream" },
		},
	})

	if (!upstream.ok || upstream.body === null) {
		const message = `stream proxy upstream not streamable runId=${runId} status=${upstream.status}`
		if (upstream.status === 499) {
			slog("bff", message)
		} else {
			swarn("bff", message)
		}
		return passthroughResponse(upstream)
	}

	slog("bff", `stream proxy handing off body runId=${runId}`)
	return new Response(upstream.body, { status: 200, headers: SSE_HEADERS })
}
