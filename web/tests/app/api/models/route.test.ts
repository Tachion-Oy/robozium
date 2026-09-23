import { beforeEach, describe, expect, it, vi } from "vitest"

const fetchAgentUpstream = vi.fn()
const passthroughResponse = vi.fn((upstream: Response) =>
	new Response(upstream.body, {
		status: upstream.status,
		headers: upstream.headers,
	}),
)

vi.mock("../../../../lib/robozium/http", () => ({
	fetchAgentUpstream,
	passthroughResponse,
}))

beforeEach(() => vi.clearAllMocks())

describe("/api/models", () => {
	it("GET proxies model selection with no-store caching", async () => {
		const request = new Request("http://next.test/api/models")
		const upstream = Response.json({ models: [], selected_model_id: "one" })
		fetchAgentUpstream.mockResolvedValueOnce(upstream)
		const { GET } = await import("../../../../app/api/models/route")

		const response = await GET(request)

		expect(fetchAgentUpstream).toHaveBeenCalledWith({
			request,
			path: "/models",
			init: { method: "GET", headers: { Accept: "application/json" } },
		})
		expect(response.headers.get("Cache-Control")).toBe("no-store")
		expect(await response.json()).toEqual({
			models: [],
			selected_model_id: "one",
		})
	})

	it("GET forwards an encoded run id", async () => {
		const request = new Request(
			"http://next.test/api/models?run_id=run%2Fone",
		)
		fetchAgentUpstream.mockResolvedValueOnce(
			Response.json({ models: [], selected_model_id: "one" }),
		)
		const { GET } = await import("../../../../app/api/models/route")

		await GET(request)

		expect(fetchAgentUpstream).toHaveBeenCalledWith(
			expect.objectContaining({ path: "/models?run_id=run%2Fone" }),
		)
	})

	it("POST forwards the selected model body", async () => {
		const request = new Request("http://next.test/api/models", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model_id: "model:cerebras:gpt-oss-120b",
				run_id: "run-one",
			}),
		})
		const upstream = Response.json({
			models: [],
			selected_model_id: "model:cerebras:gpt-oss-120b",
		})
		fetchAgentUpstream.mockResolvedValueOnce(upstream)
		const { POST } = await import("../../../../app/api/models/route")

		const response = await POST(request)

		expect(fetchAgentUpstream).toHaveBeenCalledWith({
			request,
			path: "/models",
			init: {
				method: "POST",
				headers: {
					Accept: "application/json",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model_id: "model:cerebras:gpt-oss-120b",
					run_id: "run-one",
				}),
			},
		})
		expect(response.headers.get("Cache-Control")).toBe("no-store")
		expect((await response.json()).selected_model_id).toBe(
			"model:cerebras:gpt-oss-120b",
		)
	})
})
