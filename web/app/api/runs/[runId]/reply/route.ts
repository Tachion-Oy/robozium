import { fetchAgentUpstream, passthroughResponse } from "@/lib/robosprawl/http";
import type { ReplyBody } from "@/lib/robosprawl/wire";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const body: ReplyBody = (await request.json()) as ReplyBody;

  const upstream = await fetchAgentUpstream({
    request,
    path: `/run/${encodeURIComponent(runId)}/reply`,
    init: {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  });

  return passthroughResponse(upstream);
}
