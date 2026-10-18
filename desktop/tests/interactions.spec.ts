import { expect } from "@playwright/test"
import type { ServerResponse } from "node:http"
import { test, json, prepareRun, snapshot, start, output } from "./run-fixture"

const waiting = (prompt = "p1") => snapshot({ status: "awaiting_user_input", current_prompt_id: prompt, current_prompt: `Question ${prompt}` })

test("reply keyboard respects Shift and IME; duplicate Send preserves edits and suppresses acknowledged prompts", async ({ desktop: { page }, backend }) => {
	prepareRun(backend)
	backend.handlers.set("GET /run/run-one", response => json(response, waiting()))
	let pending: ServerResponse | undefined
	backend.handlers.set("POST /run/run-one/reply", (response, body) => {
		expect(body).toEqual({ prompt_id: "p1", content: "First\nSecond" })
		pending = response
	})
	await start(page, backend)
	await expect(output(page)).toHaveText("Question p1")
	const editor = page.getByRole("textbox", { name: "Reply", exact: true })
	await editor.fill("First")
	await editor.press("Shift+Enter")
	await editor.press("S"); await editor.press("e"); await editor.press("c"); await editor.press("o"); await editor.press("n"); await editor.press("d")
	await editor.dispatchEvent("keydown", { key: "Enter", isComposing: true })
	expect(pending).toBeUndefined()
	await editor.press("Enter")
	await expect.poll(() => pending).toBeDefined()
	await expect(page.getByRole("button", { name: "Sending…" })).toBeDisabled()
	await editor.press("Enter")
	await editor.fill("Edited while sending")
	json(pending!, { ok: true })
	await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled()
	await expect(editor).toHaveValue("Edited while sending")
	expect(backend.requests.filter(request => request.path.endsWith("/reply"))).toHaveLength(1)
	await expect.poll(() => backend.requests.filter(request => request.path === "/run/run-one").length).toBeGreaterThan(1)
	await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled()
})

test("acknowledgement clears only the unchanged draft and new prompts can be answered", async ({ desktop: { page }, backend }) => {
	prepareRun(backend)
	let prompt = "p1"
	backend.handlers.set("GET /run/run-one", response => json(response, waiting(prompt)))
	backend.handlers.set("POST /run/run-one/reply", response => { prompt = "p2"; json(response, { ok: true }) })
	await start(page, backend)
	const editor = page.getByRole("textbox", { name: "Reply", exact: true })
	await editor.fill("Answer")
	await page.getByRole("button", { name: "Send", exact: true }).click()
	await expect(editor).toHaveValue("")
	await expect(output(page)).toHaveText("Question p2")
	await editor.fill("Next answer")
	await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled()
})

for (const failure of ["rejection", "timeout", "malformed"] as const) {
	test(`reply ${failure} retains the draft, refreshes state and never repeats the write`, async ({ desktop: { page }, backend }) => {
		prepareRun(backend)
		backend.handlers.set("GET /run/run-one", response => json(response, waiting()))
		backend.handlers.set("POST /run/run-one/reply", response => {
			if (failure !== "timeout") json(response, failure === "rejection" ? { detail: "Prompt expired" } : { ok: false }, failure === "rejection" ? 409 : 200)
		})
		await start(page, backend)
		await page.clock.install()
		const editor = page.getByRole("textbox", { name: "Reply", exact: true })
		await editor.fill("Keep answer")
		const reads = backend.requests.filter(request => request.path === "/run/run-one").length
		await editor.press("Enter")
		await expect.poll(() => backend.requests.filter(request => request.path.endsWith("/reply")).length).toBe(1)
		if (failure === "timeout") await page.clock.fastForward(10_001)
		await expect(page.getByRole("alert")).toContainText(failure === "timeout" ? "timed out" : failure === "rejection" ? "Prompt expired" : "acknowledge")
		await expect(editor).toHaveValue("Keep answer")
		await expect.poll(() => backend.requests.filter(request => request.path === "/run/run-one").length).toBeGreaterThan(reads)
		await page.clock.fastForward(30_000)
		expect(backend.requests.filter(request => request.path.endsWith("/reply"))).toHaveLength(1)
	})
}

test("a late acknowledgement of an obsolete prompt cannot clear a new draft", async ({ desktop: { page }, backend }) => {
	prepareRun(backend)
	let prompt = "p1"
	backend.handlers.set("GET /run/run-one", response => json(response, waiting(prompt)))
	let pending: ServerResponse | undefined
	backend.handlers.set("POST /run/run-one/reply", response => { pending = response })
	await start(page, backend)
	await page.clock.install()
	const editor = page.getByRole("textbox", { name: "Reply", exact: true })
	await editor.fill("Draft")
	await editor.press("Enter")
	await expect.poll(() => pending).toBeDefined()
	prompt = "p2"
	await page.clock.fastForward(2001)
	await expect(output(page)).toHaveText("Question p2")
	json(pending!, { ok: true })
	await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled()
	await expect(editor).toHaveValue("Draft")
})
