import { fetchAgentUpstream, passthroughResponse } from "@/lib/robosprawl/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // Re-forward the multipart body; do NOT set Content-Type so fetch derives a
  // fresh boundary for the upstream request.
  const form = await request.formData();

  const upstream = await fetchAgentUpstream({
    request,
    path: "/transcribe",
    init: {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
      body: form,
    },
  });

  return passthroughResponse(upstream);
}
