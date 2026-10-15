// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest"
vi.mock("@/lib/robozium/config", () => ({ ROBOZIUM_API_BASE_URL: "http://backend" }))

const { fetchAgentUpstream } = vi.hoisted(() => ({ fetchAgentUpstream: vi.fn() }))
vi.mock("@/lib/robozium/http", async (importOriginal) => ({
	...await importOriginal<typeof import("@/lib/robozium/http")>(),
	fetchAgentUpstream,
	passthroughResponse: (response: Response) => response,
}))

import { POST } from "@/app/api/runs/[runId]/reply/route"

const params = { params: Promise.resolve({ runId: "run/one" }) }
beforeEach(() => {
	fetchAgentUpstream.mockReset()
	fetchAgentUpstream.mockResolvedValue(Response.json({ ok: true }))
})

it("preserves JSON replies and encoded run paths", async () => {
	const request = new Request("http://next.test/api/runs/one/reply", {
		method: "POST", body: JSON.stringify({ content: "continue" }),
		headers: { "Content-Type": "application/json" },
	})
	const response = await POST(request, params)
	expect(await response.json()).toEqual({ ok: true })
	expect(fetchAgentUpstream).toHaveBeenCalledWith({
		request, path: "/run/run%2Fone/reply", init: {
			method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
			body: JSON.stringify({ content: "continue" }),
		},
	})
})

it("forwards ordered image files and the original multipart boundary", async () => {
	const form = new FormData()
	form.append("prompt_id", "prompt-one")
	form.append("content", "")
	form.append("images", new Blob(["first"], { type: "image/png" }), "first.png")
	form.append("images", new Blob(["second"], { type: "image/jpeg" }), "second.jpg")
	const request = new Request("http://next.test/reply", { method: "POST", body: form })
	const contentType = request.headers.get("content-type")
	await POST(request, params)
	const { init } = fetchAgentUpstream.mock.calls[0][0]
	expect(init.headers["Content-Type"]).toBe(contentType)
	const forwarded = await new Request("http://api.test/reply", init).formData()
	expect(forwarded.get("prompt_id")).toBe("prompt-one")
	expect(forwarded.get("content")).toBe("")
	const files = forwarded.getAll("images") as File[]
	expect(files.map((file) => file.name)).toEqual(["first.png", "second.jpg"])
	expect(await Promise.all(files.map((file) => file.text()))).toEqual(["first", "second"])
})

it.each([true, false])("bounds multipart before forwarding (declared length: %s)", async (declared) => {
	const headers = new Headers({ "Content-Type": "multipart/form-data; boundary=b" })
	if (declared) headers.set("Content-Length", String(41 * 1024 * 1024 + 1))
	const request = new Request("http://next.test/reply", {
		method: "POST", headers, body: declared ? "" : new Uint8Array(41 * 1024 * 1024 + 1),
	})
	expect((await POST(request, params)).status).toBe(413)
	expect(fetchAgentUpstream).not.toHaveBeenCalled()
})

it("preserves unsupported-image errors from the backend", async () => {
	const error = { code: "images_not_supported", message: "The receiving model does not accept images" }
	fetchAgentUpstream.mockResolvedValueOnce(Response.json(error, { status: 400 }))
	const response = await POST(new Request("http://next.test/reply", {
		method: "POST", body: JSON.stringify({ content: "hello" }),
	}), params)
	expect(response.status).toBe(400)
	expect(await response.json()).toEqual(error)
})
