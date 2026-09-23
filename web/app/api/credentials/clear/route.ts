import { fetchAgentUpstream, passthroughResponse } from "@/lib/robozium/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
	const upstream = await fetchAgentUpstream({
		request,
		path: "/credentials/clear",
		init: { method: "POST", headers: { Accept: "application/json" } },
	})
	const response = passthroughResponse(upstream)
	response.headers.set("Cache-Control", "no-store")
	return response
}
