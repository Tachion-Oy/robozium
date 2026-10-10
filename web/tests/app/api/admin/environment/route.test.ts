import { beforeEach, expect, it, vi } from "vitest"

const { fetchAgentUpstream } = vi.hoisted(() => ({ fetchAgentUpstream: vi.fn() }))
vi.mock("@/lib/robozium/http", () => ({ fetchAgentUpstream, passthroughResponse: (response: Response) => response }))
import { POST } from "@/app/api/admin/environment/route"

beforeEach(() => vi.clearAllMocks())

it("accepts the browser host when Next uses its internal container hostname", async () => {
	fetchAgentUpstream.mockResolvedValueOnce(Response.json({ operation: "pending" }))
	const response = await POST(new Request("http://internal-container:3000/api/admin/environment", {
		method: "POST", headers: { Host: "localhost:6969", Origin: "http://localhost:6969", "Content-Type": "application/json" }, body: "{}",
	}))
	expect(response.status).toBe(200)
	expect(response.headers.get("Cache-Control")).toBe("no-store")
	expect(fetchAgentUpstream).toHaveBeenCalledOnce()
})

it.each(["http://unrelated.example", "null", "not-an-origin"])("rejects origin %s before forwarding credentials", async origin => {
	const response = await POST(new Request("http://localhost:6969/api/admin/environment", {
		method: "POST", headers: { Host: "localhost:6969", Origin: origin, "Content-Type": "application/json" }, body: "{}",
	}))
	expect(response.status).toBe(403)
	expect(fetchAgentUpstream).not.toHaveBeenCalled()
})
