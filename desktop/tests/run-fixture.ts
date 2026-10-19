import type { ServerResponse } from "node:http"
import { expect, type Page } from "@playwright/test"
import { json, type Backend } from "./selection-fixture"
import { chooseView } from "./native"
export { test, json, catalogue } from "./selection-fixture"

export const snapshot = (overrides: Record<string, unknown> = {}) => ({
	project: "existing-project", status: "running", message_trace: [],
	current_prompt_id: null, current_prompt: null, error: null, ...overrides,
})
export const message = (sequence: number, content: string, id = `m${sequence}`) => ({
	type: "message", sequence, message_id: id,
	payload: { role: "assistant", content, message_kind: "user_notification" },
})
export const delta = (sequence: number, text: string, chunk = 0, id = "live") => ({
	type: "message_delta", sequence, payload: { message_id: id, delta: text, chunk_index: chunk, agent_name: "orchestrator" },
})
export function emit(response: ServerResponse, frame: unknown) { response.write(`data: ${JSON.stringify(frame)}\n\n`) }
export function prepareRun(backend: Backend, id = "run-one", project = "existing-project") {
	const streams: ServerResponse[] = []
	let closed = 0
	backend.handlers.set("POST /run/create", response => json(response, { run_id: id }))
	backend.handlers.set(`GET /run/${id}`, response => json(response, snapshot({ project })))
	backend.handlers.set(`GET /run/${id}/stream`, response => {
		response.writeHead(200, { "Content-Type": "text/event-stream" })
		response.write(": open\n\n")
		streams.push(response)
		response.on("close", () => closed++)
	})
	return { streams, get closed() { return closed } }
}
export async function start(page: Page, backend: Backend) {
	await backend.open()
	await page.getByRole("button", { name: "existing-project", exact: true }).click()
	await page.getByRole("button", { name: "Start run", exact: true }).click()
	await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toBeFocused()
}
export async function view(page: Page, label: string) {
	await chooseView(page, label)
}
export const output = (page: Page) => page.locator(".hud-panel--agent pre")
export const runStatus = (page: Page) => page.getByRole("status", { name: "Run status" })
