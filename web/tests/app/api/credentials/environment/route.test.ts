import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { POST as importPackage } from "@/app/api/credentials/environment/import/route"
import { POST as save } from "@/app/api/credentials/environment/route"

vi.mock("@/lib/robozium/config", () => ({ ROBOZIUM_API_BASE_URL: "http://backend" }))
const upstream = vi.fn()
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", upstream) })
afterEach(() => vi.unstubAllGlobals())

it("preserves multipart filenames and contents through the container proxy", async () => {
	const body = '--folder\r\nContent-Disposition: form-data; name="files"; filename="sample/nested/tool.py"\r\nContent-Type: text/plain\r\n\r\nsource\r\n--folder--\r\n'
	upstream.mockResolvedValue(Response.json({ imported: { name: "sample" } }))
	const result = await importPackage(new Request("http://internal-container/api/credentials/environment/import", {
		method: "POST", body,
		headers: { Host: "localhost:6969", Origin: "http://localhost:6969", "Content-Type": "multipart/form-data; boundary=folder" },
	}))
	expect(result.status).toBe(200)
	const [url, init] = upstream.mock.calls[0]
	expect(url).toBe("http://backend/credentials/environment/import")
	expect(init.headers["Content-Type"]).toBe("multipart/form-data; boundary=folder")
	expect(new TextDecoder().decode(init.body)).toBe(body)
	expect(result.headers.get("Cache-Control")).toBe("no-store")
})

it("rejects cross-origin uploads without forwarding files", async () => {
	const result = await importPackage(new Request("http://localhost/api/credentials/environment/import", {
		method: "POST", body: "private-source", headers: { Host: "localhost", Origin: "https://elsewhere.example" },
	}))
	expect(result.status).toBe(403)
	expect(upstream).not.toHaveBeenCalled()
})

it("rejects oversized settings without forwarding their contents", async () => {
	const result = await save(new Request("http://localhost/api/credentials/environment", {
		method: "POST", body: "x".repeat(262145), headers: { "Content-Type": "application/json" },
	}))
	expect(result.status).toBe(413)
	expect(upstream).not.toHaveBeenCalled()
})
