import { createServer, type ServerResponse } from "node:http"
import { once } from "node:events"
import path from "node:path"
import { expect } from "@playwright/test"
import { test as native, desktopRoot } from "./native"

export const catalogue = {
	models: [{ model_id: "one", label: "First model" }, { model_id: "two", label: "Second model" }],
	selected_model_id: "one",
}
/** A backend project summary; tests override the status or run identity they exercise. */
export const project = (slug: string, overrides: Record<string, unknown> = {}) => ({
	slug, status: "dormant", run_id: null, created_at: null, ...overrides,
})
export function json(response: ServerResponse, body: unknown, status = 200) {
	response.writeHead(status, { "Content-Type": "application/json" })
	response.end(JSON.stringify(body))
}
type Handler = (response: ServerResponse, body: unknown) => void
export interface Backend {
	handlers: Map<string, Handler>
	requests: { method: string; path: string; body: unknown }[]
	/** Connect the app; by default wait until the overview has listed projects. */
	open: (options?: { awaitOverview?: boolean }) => Promise<void>
}

// Substitute only the selected connection and HTTP boundary, running the built app.
export const test = native.extend<{ backend: Backend }>({
	backend: async ({ desktop: { app, page } }, use) => {
		const handlers = new Map<string, Handler>([
			["GET /ready", response => json(response, { status: "ready" })],
			["GET /projects", response => json(response, [project("existing-project")])],
			["GET /models", response => json(response, catalogue)],
			["GET /capabilities", response => json(response, [])],
		])
		// Unsaved projects answer null and saves echo, unless a test sets an exact handler.
		const capabilityDefault = (method: string, url: string): Handler | undefined => {
			if (!/^\/capabilities\/[^/]+$/.test(url)) return undefined
			if (method === "GET") return response => json(response, null)
			if (method === "POST") return (response, body) => json(response, body)
			return undefined
		}
		const requests: Backend["requests"] = []
		const server = createServer(async (request, response) => {
			response.setHeader("Access-Control-Allow-Origin", "robozium://app")
			if (request.method === "OPTIONS") {
				response.setHeader("Access-Control-Allow-Headers", "Content-Type")
				response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE")
				response.end()
				return
			}
			let text = ""
			for await (const chunk of request) text += chunk
			const body: unknown = text ? JSON.parse(text) : undefined
			requests.push({ method: request.method!, path: request.url!, body })
			const handler = handlers.get(`${request.method} ${request.url}`) ?? capabilityDefault(request.method!, request.url!)
			if (handler) handler(response, body)
			else json(response, { detail: "Unexpected test request" }, 404)
		})
		server.listen(0, "127.0.0.1")
		await once(server, "listening")
		const address = server.address()
		if (!address || typeof address === "string") throw new Error("No test server port")
		try {
			await use({ handlers, requests, open: async ({ awaitOverview = true } = {}) => {
				await app.evaluate(async ({ ipcMain, protocol }, { baseUrl, modulePath }) => {
					ipcMain.removeHandler("desktop:backend-connection")
					ipcMain.handle("desktop:backend-connection", () => ({ baseUrl, mode: "mock" }))
					protocol.unhandle("robozium")
					const load = process.getBuiltinModule("module").createRequire(modulePath)
					await load(modulePath).registerRendererProtocol(baseUrl)
				}, { baseUrl: `http://127.0.0.1:${address.port}`, modulePath: path.join(desktopRoot, "dist/renderer-protocol.js") })
				await page.reload()
				if (awaitOverview) await expect(page.getByRole("button", { name: "New Project", exact: true })).toBeVisible()
			} })
		} finally {
			await page.goto("about:blank") // Unmount/abort before closing the HTTP boundary.
			server.closeAllConnections()
			await new Promise<void>(resolve => server.close(() => resolve()))
		}
	},
})
