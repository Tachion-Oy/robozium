import { beforeEach, describe, expect, it, vi } from "vitest"

const fetchAgentUpstream = vi.fn()
const passthroughResponse = vi.fn((upstream: Response) => {
	return new Response(upstream.body, {
		status: upstream.status,
		headers: upstream.headers,
	})
})

vi.mock("../../../../../lib/robozium/http", () => ({
	fetchAgentUpstream,
	passthroughResponse,
}))

beforeEach(() => {
	vi.clearAllMocks()
})

describe("/api/admin/dependencies", () => {
	it("GET proxies the cache-only upstream endpoint and disables response caching", async () => {
		const request = new Request("http://next.test/api/admin/dependencies")
		const upstream = Response.json([{ dependency_id: "executable:bash" }])
		fetchAgentUpstream.mockResolvedValueOnce(upstream)
		const { GET } = await import(
			"../../../../../app/api/admin/dependencies/route"
		)

		const response = await GET(request)

		expect(fetchAgentUpstream).toHaveBeenCalledWith({
			request,
			path: "/admin/dependencies",
			init: {
				method: "GET",
				headers: { Accept: "application/json" },
			},
		})
		expect(passthroughResponse).toHaveBeenCalledWith(upstream)
		expect(response.status).toBe(200)
		expect(response.headers.get("Cache-Control")).toBe("no-store")
		expect(await response.json()).toEqual([
			{ dependency_id: "executable:bash" },
		])
	})

	it("POST proxies the active backend check and forwards an error response", async () => {
		const request = new Request("http://next.test/api/admin/dependencies", {
			method: "POST",
		})
		const upstream = Response.json(
			{ detail: "check failed" },
			{ status: 503 },
		)
		fetchAgentUpstream.mockResolvedValueOnce(upstream)
		const { POST } = await import(
			"../../../../../app/api/admin/dependencies/route"
		)

		const response = await POST(request)

		expect(fetchAgentUpstream).toHaveBeenCalledWith({
			request,
			path: "/admin/dependencies/check",
			init: {
				method: "POST",
				headers: { Accept: "application/json" },
			},
		})
		expect(response.status).toBe(503)
		expect(response.headers.get("Cache-Control")).toBe("no-store")
		expect(await response.json()).toEqual({ detail: "check failed" })
	})
})
