import { expect } from "@playwright/test"
import type { ServerResponse } from "node:http"
import { test, json, prepareRun, snapshot, start, output, view, runStatus } from "./run-fixture"

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


test("interruption reconciles to a prompt and permits a text reply", async ({ desktop: { page }, backend }) => {
	prepareRun(backend)
	let waitingForReply = false
	backend.handlers.set("GET /run/run-one", response => json(response, waitingForReply ? waiting() : snapshot()))
	backend.handlers.set("POST /run/run-one/interrupt", response => { waitingForReply = true; json(response, { ok: true }) })
	backend.handlers.set("POST /run/run-one/reply", response => json(response, { ok: true }))
	await start(page, backend)
	await expect(runStatus(page)).toContainText("Running")
	await page.getByRole("button", { name: "Interrupt", exact: true }).click()
	await expect(output(page)).toHaveText("Question p1")
	await expect(page.getByRole("button", { name: "Interrupt", exact: true })).toBeDisabled()
	await page.getByRole("textbox", { name: "Reply", exact: true }).fill("Continue")
	await page.getByRole("button", { name: "Send", exact: true }).click()
	await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("")
})

test("Cancel remains available during interruption and reconciles background work through overview polls", async ({ desktop: { page }, backend }) => {
	prepareRun(backend)
	let status = "running"
	backend.handlers.set("GET /projects", response => json(response, [{ slug: "existing-project", status, run_id: "run-one" }]))
	let interrupt: ServerResponse | undefined
	let cancel: ServerResponse | undefined
	backend.handlers.set("POST /run/run-one/interrupt", response => { interrupt = response })
	backend.handlers.set("POST /projects/existing-project/cancel", response => { cancel = response })
	await start(page, backend)
	await page.clock.install()
	await page.getByRole("textbox", { name: "Reply", exact: true }).fill("Retained")
	await page.getByRole("button", { name: "Interrupt", exact: true }).click()
	await expect.poll(() => interrupt).toBeDefined()
	await page.getByRole("button", { name: "Cancel", exact: true }).click()
	await expect.poll(() => cancel).toBeDefined()
	await expect(page.getByRole("button", { name: "Cancelling…", exact: true })).toBeDisabled()
	status = "syncing"
	json(cancel!, { ok: true })
	await view(page, "Runs Overview")
	await expect(page.getByRole("button", { name: "Cancel existing-project" })).toBeDisabled()
	status = "dormant"
	await page.clock.fastForward(251)
	await expect(page.getByRole("list", { name: "Projects", exact: true })).toContainText("dormant")
	await page.getByRole("button", { name: "Return to run" }).click()
	await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("Retained")
	json(interrupt!, { ok: true })
	expect(backend.requests.filter(request => request.path.endsWith("/cancel"))).toHaveLength(1)
})

for (const action of ["interrupt", "cancel"] as const) {
	test(`${action} failure retains drafts and permits explicit retry`, async ({ desktop: { page }, backend }) => {
		prepareRun(backend)
		backend.handlers.set(action === "interrupt" ? "POST /run/run-one/interrupt" : "POST /projects/existing-project/cancel", response => json(response, { detail: "Try later" }, 503))
		await start(page, backend)
		await page.getByRole("textbox", { name: "Reply", exact: true }).fill("Keep")
		await page.getByRole("button", { name: action === "interrupt" ? "Interrupt" : "Cancel", exact: true }).click()
		await expect(page.getByRole("alert")).toContainText("Try later")
		await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("Keep")
		expect(backend.requests.filter(request => request.path.endsWith(`/${action}`))).toHaveLength(1)
	})
}
