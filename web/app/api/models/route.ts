import { fetchAgentUpstream, passthroughResponse } from "@/lib/robosprawl/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function noStore(upstream: Response): Response {
	const response = passthroughResponse(upstream)
	response.headers.set("Cache-Control", "no-store")
	return response
}

export async function GET(request: Request) {
	const runId = new URL(request.url).searchParams.get("run_id")
	const path = runId
		? `/models?run_id=${encodeURIComponent(runId)}`
		: "/models"
	const upstream = await fetchAgentUpstream({
		request,
		path,
		init: {
			method: "GET",
			headers: { Accept: "application/json" },
		},
	})
	return noStore(upstream)
}

export async function POST(request: Request) {
	const body = await request.json()
	const upstream = await fetchAgentUpstream({
		request,
		path: "/models",
		init: {
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		},
	})
	return noStore(upstream)
}
