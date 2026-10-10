import { fetchAgentUpstream, passthroughResponse } from "@/lib/robozium/http"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
	const response = passthroughResponse(await fetchAgentUpstream({ request, path: "/admin/environment" }))
	response.headers.set("Cache-Control", "no-store")
	return response
}
export async function POST(request: Request) {
	const origin = request.headers.get("origin")
	let sameOrigin = !origin
	try { sameOrigin = !origin || new URL(origin).host === request.headers.get("host") } catch { /* Invalid origins are rejected. */ }
	if (!sameOrigin)
		return Response.json({ detail: "Cross-origin configuration changes are not allowed" }, { status: 403 })
	if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
		return Response.json({ detail: "Configuration changes require JSON" }, { status: 415 })
	const reader = request.body?.getReader()
	if (!reader) return Response.json({ detail: "Missing request" }, { status: 400 })
	const chunks: Uint8Array[] = []
	let length = 0
	while (true) {
		const { done, value } = await reader.read()
		if (done) break
		length += value.length
		if (length > 262144) {
			await reader.cancel()
			return Response.json({ detail: "Environment request is too large" }, { status: 413 })
		}
		chunks.push(value)
	}
	const body = new Uint8Array(length)
	let offset = 0
	for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length }
	const response = passthroughResponse(await fetchAgentUpstream({
		request, path: "/admin/environment", init: {
			method: "POST", headers: { "Content-Type": "application/json" }, body,
		},
	}))
	response.headers.set("Cache-Control", "no-store")
	return response
}
