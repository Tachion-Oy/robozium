import { describe, expect, it, vi } from "vitest"

const fetchAgentUpstream = vi.fn()
const passthroughResponse = vi.fn()

vi.mock("../../../../lib/robozium/http", () => ({
	fetchAgentUpstream,
	passthroughResponse,
}))

describe("GET /api/files/[...path]", () => {
	it("proxies hub-relative path segments to upstream files route", async () => {
		const request = new Request("http://next.test/api/files/projects/a%20b/documents/cv.txt")
		const upstream = new Response("file-body", {
			headers: { "Content-Type": "text/plain" },
		})
		fetchAgentUpstream.mockResolvedValueOnce(upstream)
		passthroughResponse.mockReturnValueOnce(
			new Response(upstream.body, {
				status: upstream.status,
				headers: upstream.headers,
			}),
		)

		const { GET } = await import("../../../../app/api/files/[...path]/route")
		const response = await GET(request, {
			params: Promise.resolve({
				path: ["projects", "a b", "documents", "cv.txt"],
			}),
		})

		expect(fetchAgentUpstream).toHaveBeenCalledWith({
			request,
			path: "/files/projects/a%20b/documents/cv.txt",
			init: { headers: { Accept: "*/*" } },
		})
		expect(passthroughResponse).toHaveBeenCalledWith(
			upstream,
			"application/octet-stream",
		)
		expect(response.headers.get("Cache-Control")).toBe("no-store")
		expect(await response.text()).toBe("file-body")
	})
})
