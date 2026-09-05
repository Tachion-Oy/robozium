import { fetchAgentUpstream, passthroughResponse } from "@/lib/robosprawl/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
	const upstream = await fetchAgentUpstream({
		request,
		path: "/projects",
		init: {
			method: "GET",
			headers: {
				Accept: "application/json",
			},
		},
	})
	return passthroughResponse(upstream)
}

export async function POST(request: Request) {
	const body = await request.json()
	const upstream = await fetchAgentUpstream({
		request,
		path: "/projects",
		init: {
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		},
	})
	return passthroughResponse(upstream)
}
