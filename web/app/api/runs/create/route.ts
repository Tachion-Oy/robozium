import { fetchAgentUpstream, passthroughResponse } from "@/lib/robozium/http";
import type { CreateBody } from "@/lib/robozium/wire";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body: CreateBody = await request.json() as CreateBody;

  const upstream = await fetchAgentUpstream({
    request,
    path: "/run/create",
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
