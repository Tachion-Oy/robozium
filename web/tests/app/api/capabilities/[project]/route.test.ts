import { beforeEach, expect, it, vi } from "vitest"

const { fetchAgentUpstream } = vi.hoisted(() => ({ fetchAgentUpstream: vi.fn() }))
vi.mock("../../../../../lib/robozium/http", () => ({
	fetchAgentUpstream,
	passthroughResponse: (response: Response) => response,
}))
import { GET, POST } from "../../../../../app/api/capabilities/[project]/route"

beforeEach(() => vi.clearAllMocks())

it.each([
	[200, null],
	[200, { email: "on_demand", removed: true }],
	[404, { detail: "unknown project" }],
	[500, { detail: "Could not read saved capabilities" }],
])("GET forwards the saved selection and status %s without caching", async (status, body) => {
	const request = new Request("http://next.test/api/capabilities/alpha%20beta")
	fetchAgentUpstream.mockResolvedValueOnce(Response.json(body, { status }))
	const response = await GET(request, { params: Promise.resolve({ project: "alpha beta" }) })
	expect(fetchAgentUpstream).toHaveBeenCalledWith({
		request, path: "/capabilities/alpha%20beta",
		init: { method: "GET", headers: { Accept: "application/json" } },
	})
	expect(response.status).toBe(status)
	expect(response.headers.get("Cache-Control")).toBe("no-store")
	expect(await response.json()).toEqual(body)
})

it.each([200, 422, 500])("POST preserves the body and upstream status %s", async (status) => {
	const body = status === 422 ? "{broken" : JSON.stringify({ email: "on_demand" })
	const result = status === 200 ? { email: "on_demand" } : { detail: "Rejected" }
	const request = new Request("http://next.test/api/capabilities/alpha%20beta", {
		method: "POST", headers: { "Content-Type": "application/json" }, body,
	})
	fetchAgentUpstream.mockResolvedValueOnce(Response.json(result, { status }))
	const response = await POST(request, { params: Promise.resolve({ project: "alpha beta" }) })
	expect(fetchAgentUpstream).toHaveBeenCalledWith({
		request, path: "/capabilities/alpha%20beta",
		init: {
			method: "POST",
			headers: { Accept: "application/json", "Content-Type": "application/json" }, body,
		},
	})
	expect(response.status).toBe(status)
	expect(response.headers.get("Cache-Control")).toBe("no-store")
	expect(await response.json()).toEqual(result)
})
