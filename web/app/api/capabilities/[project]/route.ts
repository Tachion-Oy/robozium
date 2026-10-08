import { fetchAgentUpstream, passthroughResponse } from "@/lib/robozium/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ project: string }> }

function noStore(upstream: Response): Response {
	const response = passthroughResponse(upstream)
	response.headers.set("Cache-Control", "no-store")
	return response
}

export async function GET(request: Request, { params }: Context) {
	const { project } = await params
	const upstream = await fetchAgentUpstream({
		request,
		path: `/capabilities/${encodeURIComponent(project)}`,
		init: { method: "GET", headers: { Accept: "application/json" } },
	})
	return noStore(upstream)
}

export async function POST(request: Request, { params }: Context) {
	const { project } = await params
	const upstream = await fetchAgentUpstream({
		request,
		path: `/capabilities/${encodeURIComponent(project)}`,
		init: {
			method: "POST",
			headers: { Accept: "application/json", "Content-Type": "application/json" },
			body: await request.text(),
		},
	})
	return noStore(upstream)
}
