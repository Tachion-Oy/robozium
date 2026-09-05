import { fetchAgentUpstream, passthroughResponse } from "@/lib/robosprawl/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function noStore(upstream: Response): Response {
	const response = passthroughResponse(upstream)
	response.headers.set("Cache-Control", "no-store")
	return response
}

export async function GET(request: Request) {
	const upstream = await fetchAgentUpstream({
		request,
		path: "/admin/dependencies",
		init: {
			method: "GET",
			headers: {
				Accept: "application/json",
			},
		},
	})
	return noStore(upstream)
}

export async function POST(request: Request) {
	const upstream = await fetchAgentUpstream({
		request,
		path: "/admin/dependencies/check",
		init: {
			method: "POST",
			headers: {
				Accept: "application/json",
			},
		},
	})
	return noStore(upstream)
}
