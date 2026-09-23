import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchAgentUpstream,
  isPollingPath,
  passthroughResponse,
} from "../../../lib/robozium/http";

vi.mock("../../../lib/robozium/config", () => ({
  ROBOZIUM_API_BASE_URL: "http://robozium.test",
}));

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchAgentUpstream", () => {
  it("fetches base URL + path with init merged and no-store", async () => {
    const upstream = jsonResponse({ ok: true });
    fetchMock.mockResolvedValueOnce(upstream);

    const request = new Request("http://next.test/api", { method: "GET" });
    const result = await fetchAgentUpstream({
      request,
      path: "/run/abc/stream",
      init: {
        headers: { Accept: "text/event-stream" },
      },
    });

    expect(result).toBe(upstream);
    expect(fetchMock).toHaveBeenCalledWith("http://robozium.test/run/abc/stream", {
      headers: { Accept: "text/event-stream" },
      signal: request.signal,
      cache: "no-store",
    });
  });

  it("returns 499 when request was aborted and fetch fails", async () => {
    const ac = new AbortController();
    ac.abort();
    const request = new Request("http://next.test", { signal: ac.signal });
    fetchMock.mockRejectedValueOnce(new Error("aborted"));

    const res = await fetchAgentUpstream({ request, path: "/p" });
    expect(res.status).toBe(499);
  });

  it("returns 502 JSON when fetch fails and not aborted", async () => {
    const request = new Request("http://next.test");
    fetchMock.mockRejectedValueOnce(new Error("connect refused"));

    const res = await fetchAgentUpstream({ request, path: "/p" });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toBe("connect refused");
  });
});

describe("isPollingPath", () => {
  it("matches the GET status-polling endpoints", () => {
    expect(isPollingPath("GET", "/projects")).toBe(true);
    expect(isPollingPath("GET", "/runs")).toBe(false);
    expect(isPollingPath("GET", "/run/abc123")).toBe(true);
    expect(isPollingPath("GET", "/run/abc123?since=10")).toBe(true);
    expect(isPollingPath("GET", "/run/abc123/")).toBe(true);
  });

  it("does not match stream/reply or non-GET requests", () => {
    expect(isPollingPath("GET", "/run/abc123/stream")).toBe(false);
    expect(isPollingPath("GET", "/run/abc123/reply")).toBe(false);
    expect(isPollingPath("POST", "/run/abc123")).toBe(false);
  });
});

describe("passthroughResponse", () => {
  it("forwards status, body, and Content-Type from upstream", async () => {
    const upstream = new Response("hello", {
      status: 201,
      headers: { "Content-Type": "text/plain" },
    });

    const out = passthroughResponse(upstream);
    expect(out.status).toBe(201);
    expect(out.headers.get("Content-Type")).toBe("text/plain");
    expect(await out.text()).toBe("hello");
  });

  it("uses fallback Content-Type when missing", () => {
    const upstream = new Response(null, { status: 204 });
    const out = passthroughResponse(upstream);
    expect(out.headers.get("Content-Type")).toBe("application/json");
  });
});
