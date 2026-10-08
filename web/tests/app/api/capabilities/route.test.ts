import { expect, it, vi } from "vitest"

const { fetchAgentUpstream } = vi.hoisted(() => ({ fetchAgentUpstream: vi.fn() }))
vi.mock("../../../../lib/robozium/http", () => ({
	fetchAgentUpstream,
	passthroughResponse: (response: Response) => response,
}))
import { GET } from "../../../../app/api/capabilities/route"

it.each([200, 503])("forwards the catalog response and status %s without caching", async (status) => {
	const request = new Request("http://next.test/api/capabilities")
	const body = status === 200 ? [{ name: "email", kind: "skill", selectable: true, loading: "automatic" }] : { detail: "Unavailable" }
	fetchAgentUpstream.mockResolvedValueOnce(Response.json(body, { status }))
	const response = await GET(request)
	expect(fetchAgentUpstream).toHaveBeenCalledWith({ request, path: "/capabilities", init: { method: "GET", headers: { Accept: "application/json" } } })
	expect(response.status).toBe(status)
	expect(response.headers.get("Cache-Control")).toBe("no-store")
	expect(await response.json()).toEqual(body)
})
