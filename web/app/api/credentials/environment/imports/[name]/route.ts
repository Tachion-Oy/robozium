import { proxyEnvironmentRequest } from "@/lib/robozium/http"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function DELETE(request: Request, { params }: { params: Promise<{ name: string }> }) {
	const { name } = await params
	return proxyEnvironmentRequest(request, `/credentials/environment/imports/${encodeURIComponent(name)}`)
}
