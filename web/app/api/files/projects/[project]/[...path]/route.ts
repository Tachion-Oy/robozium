import { fetchAgentUpstream, passthroughResponse } from "@/lib/robosprawl/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ project: string; path: string[] }> },
) {
	const { project, path } = await params
	const safePath = path
		.map((segment) => encodeURIComponent(segment))
		.join("/")
	const upstream = await fetchAgentUpstream({
		request,
		path: `/files/projects/${encodeURIComponent(project)}/${safePath}`,
		init: {
			headers: { Accept: "*/*" },
		},
	})
	const response = passthroughResponse(upstream, "application/octet-stream")
	response.headers.set("Cache-Control", "no-store")
	return response
}
