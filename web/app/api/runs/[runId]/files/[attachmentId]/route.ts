import { fetchAgentUpstream, passthroughResponse } from "@/lib/robozium/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function DELETE(
	request: Request,
	{ params }: { params: Promise<{ runId: string; attachmentId: string }> },
) {
	const { runId, attachmentId } = await params
	return passthroughResponse(await fetchAgentUpstream({
		request, path: `/run/${encodeURIComponent(runId)}/files/${encodeURIComponent(attachmentId)}`,
		init: { method: "DELETE" },
	}))
}
