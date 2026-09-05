import { fetchAgentUpstream, passthroughResponse } from "@/lib/robosprawl/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;

  const upstream = await fetchAgentUpstream({
    request,
    path: `/run/${encodeURIComponent(runId)}/interrupt`,
    init: {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    },
  });

  return passthroughResponse(upstream);
}
