import { fetchAgentUpstream, passthroughResponse } from "@/lib/robozium/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ runId: string }> }

export async function POST(request: Request, { params }: Context) {
	const { runId } = await params
	const incoming = new URL(request.url).searchParams
	const query = new URLSearchParams()
	for (const key of ["filename", "prompt_id", "upload_id"]) {
		const value = incoming.get(key)
		if (value !== null) query.set(key, value)
	}
	// Stream raw bytes so the API's configured limit also bounds large uploads.
	const init: RequestInit & { duplex: "half" } = {
		method: "POST", duplex: "half", body: request.body,
		headers: { "Content-Type": "application/octet-stream" },
	}
	return passthroughResponse(await fetchAgentUpstream({
		request, path: `/run/${encodeURIComponent(runId)}/files?${query}`, init,
	}))
}

async function pendingRequest(request: Request, { params }: Context) {
	const { runId } = await params
	const response = passthroughResponse(await fetchAgentUpstream({
		request, path: `/run/${encodeURIComponent(runId)}/files`,
		init: { method: request.method },
	}))
	response.headers.set("Cache-Control", "no-store")
	return response
}

export const GET = pendingRequest
export const DELETE = pendingRequest
