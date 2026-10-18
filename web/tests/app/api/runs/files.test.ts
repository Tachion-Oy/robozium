import { beforeEach, expect, it, vi } from "vitest"

vi.mock("@/lib/robozium/config", () => ({ ROBOZIUM_API_BASE_URL: "http://upstream.test" }))
const upstream = vi.hoisted(() => vi.fn())
vi.mock("@/lib/robozium/http", async (original) => ({
	...await original<typeof import("../../../../lib/robozium/http")>(),
	fetchAgentUpstream: upstream,
}))

import { GET, POST, DELETE } from "../../../../app/api/runs/[runId]/files/route"
import { DELETE as remove } from "../../../../app/api/runs/[runId]/files/[attachmentId]/route"

beforeEach(() => { upstream.mockReset() })

it("streams upload bytes and forwards only supported query parameters", async () => {
	const request = new Request("http://next.test/api/runs/one/files?filename=a%26b.png&prompt_id=prompt&upload_id=upload&clear=true", { method: "POST", body: new Uint8Array([1, 2, 3]) })
	upstream.mockImplementation(async ({ init }) => {
		expect(await new Response(init.body).arrayBuffer()).toEqual(new Uint8Array([1, 2, 3]).buffer)
		return Response.json({ id: "id", name: "a&b.png", path: "hub/image.png" })
	})
	const response = await POST(request, { params: Promise.resolve({ runId: "one/two" }) })
	const [options] = upstream.mock.calls[0]
	expect(options.path).toBe("/run/one%2Ftwo/files?filename=a%26b.png&prompt_id=prompt&upload_id=upload")
	expect(options.init.duplex).toBe("half")
	expect((await response.json()).id).toBe("id")
})

it("forwards pending reads uncached and both empty delete responses", async () => {
	const params = Promise.resolve({ runId: "one" })
	upstream.mockResolvedValueOnce(Response.json([]))
	const listed = await GET(new Request("http://next.test/api/runs/one/files"), { params })
	expect(await listed.json()).toEqual([])
	expect(listed.headers.get("Cache-Control")).toBe("no-store")
	upstream.mockResolvedValueOnce(new Response(null, { status: 204 }))
	const cleared = await DELETE(new Request("http://next.test/api/runs/one/files", { method: "DELETE" }), { params })
	expect(cleared.status).toBe(204)
	expect(await cleared.text()).toBe("")
	upstream.mockResolvedValueOnce(new Response(null, { status: 204 }))
	const removed = await remove(new Request("http://next.test/api/runs/one/files/id", { method: "DELETE" }), { params: Promise.resolve({ runId: "one", attachmentId: "id/two" }) })
	expect(removed.status).toBe(204)
	expect(upstream.mock.calls.at(-1)?.[0].path).toBe("/run/one/files/id%2Ftwo")
})
