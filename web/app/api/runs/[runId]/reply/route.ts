import { fetchAgentUpstream, passthroughResponse } from "@/lib/robozium/http";
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
    const limit = 41 * 1024 * 1024;
    if (Number(request.headers.get("content-length")) > limit) {
      return Response.json({ detail: "Reply body exceeds 41 MiB" }, { status: 413 });
    }
    const reader = request.body?.getReader();
    if (!reader) return Response.json({ detail: "Missing reply body" }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > limit) {
          await reader.cancel();
          return Response.json({ detail: "Reply body exceeds 41 MiB" }, { status: 413 });
        }
        chunks.push(value);
      }
    } catch {
      return Response.json({ detail: "Incomplete reply body" }, { status: 400 });
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
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
