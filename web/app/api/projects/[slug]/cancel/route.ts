import { fetchAgentUpstream, passthroughResponse } from "@/lib/robozium/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const upstream = await fetchAgentUpstream({
    request,
    path: `/projects/${encodeURIComponent(slug)}/cancel`,
    init: {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    },
  });

  return passthroughResponse(upstream);
}
