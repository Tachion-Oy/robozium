import { fetchAgentUpstream, passthroughResponse } from "@/lib/robozium/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ path: string[] }> },
) {
	const { path } = await params
	const safePath = path
		.map((segment) => encodeURIComponent(segment))
		.join("/")
	const upstream = await fetchAgentUpstream({
		request,
		path: `/files/${safePath}`,
		init: {
			headers: { Accept: "*/*" },
		},
	})
	const response = passthroughResponse(upstream, "application/octet-stream")
	response.headers.set("Cache-Control", "no-store")
	return response
}
