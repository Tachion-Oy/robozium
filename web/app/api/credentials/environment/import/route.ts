import { proxyEnvironmentRequest } from "@/lib/robozium/http"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
	return proxyEnvironmentRequest(request, "/credentials/environment/import")
}
