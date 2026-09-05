import { fetchAgentUpstream, passthroughResponse } from "@/lib/robosprawl/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const upstream = await fetchAgentUpstream({
    request,
    path: `/run/${encodeURIComponent(runId)}`,
    init: {
      headers: { Accept: "application/json" },
    },
  });

  const response = passthroughResponse(upstream);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
