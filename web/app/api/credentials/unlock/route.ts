import { fetchAgentUpstream, passthroughResponse } from "@/lib/robozium/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
	const body = await request.text()
	if (body.length > 4096) {
		return Response.json({ detail: "Unlock request is too large" }, { status: 413 })
	}
	const upstream = await fetchAgentUpstream({
		request,
		path: "/credentials/unlock",
		init: {
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
			},
			body,
		},
	})
	const response = passthroughResponse(upstream)
	response.headers.set("Cache-Control", "no-store")
	return response
}
