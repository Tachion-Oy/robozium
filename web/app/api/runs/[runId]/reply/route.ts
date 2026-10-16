import { fetchAgentUpstream, passthroughResponse, readBoundedBody } from "@/lib/robozium/http";
import type { ReplyBody } from "@/lib/robozium/wire";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const contentType = request.headers.get("content-type") ?? "application/json";
  const multipart = contentType.split(";", 1)[0].trim().toLowerCase() === "multipart/form-data";
  let body: BodyInit;
  if (multipart) {
    const bytes = await readBoundedBody(request, 41 * 1024 * 1024, "Reply body exceeds 41 MiB");
    if (bytes instanceof Response) return bytes;
    body = bytes;
  } else {
    const reply = (await request.json()) as ReplyBody;
    body = JSON.stringify(reply);
  }

  const upstream = await fetchAgentUpstream({
    request,
    path: `/run/${encodeURIComponent(runId)}/reply`,
    init: {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": multipart ? contentType : "application/json",
      },
      body,
    },
  });

  return passthroughResponse(upstream);
}
