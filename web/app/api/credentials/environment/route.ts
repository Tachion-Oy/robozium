import { fetchAgentUpstream, passthroughResponse, proxyEnvironmentRequest } from "@/lib/robozium/http"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
	const response = passthroughResponse(await fetchAgentUpstream({ request, path: "/credentials/environment" }))
	response.headers.set("Cache-Control", "no-store")
	return response
}
export async function POST(request: Request) {
	return proxyEnvironmentRequest(request, "/credentials/environment")
}

export async function DELETE(request: Request) {
	return proxyEnvironmentRequest(request, "/credentials/environment")
}
