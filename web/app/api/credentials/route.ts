import { fetchAgentUpstream, passthroughResponse } from "@/lib/robozium/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
	const upstream = await fetchAgentUpstream({
		request,
		path: "/credentials",
		init: { headers: { Accept: "application/json" } },
	})
	const response = passthroughResponse(upstream)
	response.headers.set("Cache-Control", "no-store")
	return response
}
