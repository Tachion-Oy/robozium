import { expect, type Page } from "@playwright/test"
import type { ServerResponse } from "node:http"
import { test, json, project, prepareRun, snapshot, start, output, view, replyBox, launchButton, runStatus } from "./run-fixture"
import type { Backend } from "./selection-fixture"

const waiting = (prompt = "p1", overrides: Record<string, unknown> = {}) =>
	snapshot({ status: "awaiting_user_input", current_prompt_id: prompt, current_prompt: `Question ${prompt}`, ...overrides })
const send = (page: Page) => page.locator(".agent-hud__send")
const replies = (backend: Backend) => backend.requests.filter(request => request.path.endsWith("/reply"))

test("Enter and Send post one trimmed reply; Shift+Enter and IME composition do not send", async ({ desktop: { page }, backend }) => {
	prepareRun(backend)
	backend.handlers.set("GET /run/run-one", response => json(response, waiting()))
	let pending: ServerResponse | undefined
	backend.handlers.set("POST /run/run-one/reply", (response, body) => {
		expect(body).toEqual({ prompt_id: "p1", content: "First\nSecond" })
		pending = response
	})
	await start(page, backend)
	await expect(output(page)).toHaveText("Question p1")
	const editor = replyBox(page)
	await expect(send(page)).toBeDisabled()
	await editor.fill("  First")
	await editor.press("Shift+Enter")
	await editor.pressSequentially("Second ")
	await editor.dispatchEvent("keydown", { key: "Enter", isComposing: true })
	await expect(send(page)).toBeEnabled()
	expect(pending).toBeUndefined()
	await editor.press("Enter")
	await expect.poll(() => pending).toBeDefined()
	await expect(send(page)).toBeDisabled()
	await editor.press("Enter")
	await send(page).evaluate(button => (button as HTMLButtonElement).click())
	json(pending!, { ok: true })
	await expect(editor).toHaveValue("")
	expect(replies(backend)).toHaveLength(1)
})

for (const edited of [false, true]) {
	test(`an acknowledgement clears the draft only if it is unchanged; edited=${edited}`, async ({ desktop: { page }, backend }) => {
		prepareRun(backend)
		backend.handlers.set("GET /run/run-one", response => json(response, waiting()))
		let pending: ServerResponse | undefined
		backend.handlers.set("POST /run/run-one/reply", response => { pending = response })
		await start(page, backend)
		const editor = replyBox(page)
		await editor.fill("Submitted answer")
		await send(page).click()
		await expect.poll(() => pending).toBeDefined()
		if (edited) await editor.fill("Next draft")
		json(pending!, { ok: true })
		await expect(send(page)).toBeDisabled()
		await expect(editor).toHaveValue(edited ? "Next draft" : "")
	})
}

test("a late snapshot cannot revive an answered prompt, and the next prompt can be answered", async ({ desktop: { page }, backend }) => {
	prepareRun(backend)
	let current = waiting()
	backend.handlers.set("GET /run/run-one", response => json(response, current))
	backend.handlers.set("POST /run/run-one/reply", response => json(response, { ok: true }))
	await page.clock.install()
	await start(page, backend)
	const editor = replyBox(page)
	await editor.fill("Answer")
	await send(page).click()
	await expect(editor).toHaveValue("")
	// The backend still reports the answered prompt for one more read.
	await page.clock.fastForward(2001)
	await editor.fill("Too early")
	await expect(send(page)).toBeDisabled()
	current = waiting("p2")
	await page.clock.fastForward(2001)
	await expect(output(page)).toHaveText("Question p2")
	await expect(send(page)).toBeEnabled()
	expect(replies(backend)).toHaveLength(1)
})

for (const failure of ["rejection", "refusal", "timeout"] as const) {
	test(`a reply ${failure} keeps the draft, reports it and is never repeated`, async ({ desktop: { page }, backend }) => {
		prepareRun(backend)
		backend.handlers.set("GET /run/run-one", response => json(response, waiting()))
		backend.handlers.set("POST /run/run-one/reply", response => {
			if (failure === "rejection") json(response, { detail: "Prompt already answered" }, 409)
			else if (failure === "refusal") json(response, { ok: false })
		})
		await page.clock.install()
		await start(page, backend)
		const editor = replyBox(page)
		await editor.fill("Keep me")
		await send(page).click()
		if (failure === "timeout") await page.clock.fastForward(10_001)
		await expect(page.getByRole("alert").filter({ hasText: "Reply failed" }))
			.toContainText("Reply failed: Could not send your reply. Your draft has been kept.")
		await expect(editor).toHaveValue("Keep me")
		await expect(send(page)).toBeEnabled()
		await page.clock.fastForward(30_000)
		expect(replies(backend)).toHaveLength(1)
	})
}

test("opening another run aborts a pending reply and ignores its late answer", async ({ desktop: { page }, backend }) => {
	const previous = prepareRun(backend)
	backend.handlers.set("GET /projects", response => json(response, [project("existing-project"), project("next-project")]))
	backend.handlers.set("GET /run/run-one", response => json(response, waiting()))
	let pending: ServerResponse | undefined
	let aborted = false
	backend.handlers.set("POST /run/run-one/reply", response => {
		pending = response
		response.on("close", () => { aborted = true })
	})
	await start(page, backend)
	await replyBox(page).fill("Keep across runs")
	await send(page).click()
	await expect.poll(() => pending).toBeDefined()
	prepareRun(backend, "next-run", "next-project")
	backend.handlers.set("GET /run/next-run", response => json(response, waiting("p2", { project: "next-project" })))
	await view(page, "Runs Overview")
	await launchButton(page, "next-project").click()
	await expect(output(page)).toHaveText("Question p2")
	await expect.poll(() => aborted).toBe(true)
	await expect.poll(() => previous.closed).toBe(previous.streams.length)
	json(pending!, { ok: true })
	await expect(replyBox(page)).toHaveValue("Keep across runs")
	await expect(send(page)).toBeEnabled()
	await expect(runStatus(page)).toContainText("next-project")
	await expect(page.getByRole("alert")).toHaveCount(0)
	expect(replies(backend)).toHaveLength(1)
})

test("Send stays unavailable while the run is working", async ({ desktop: { page }, backend }) => {
	prepareRun(backend)
	await start(page, backend)
	await replyBox(page).fill("Not now")
	await expect(runStatus(page)).toContainText("Running")
	await expect(send(page)).toBeDisabled()
	await replyBox(page).press("Enter")
	expect(replies(backend)).toHaveLength(0)
})
