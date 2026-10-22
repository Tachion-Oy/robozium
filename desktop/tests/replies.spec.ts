import { expect, type Page } from "@playwright/test"
import type { ServerResponse } from "node:http"
import { test, json, project, prepareRun, snapshot, start, output, view, replyBox, launchButton, runStatus, delta, emit, message } from "./run-fixture"
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

test("a streamed prompt enables Send before the next poll, and its close returns the agent to working", async ({ desktop: { page }, backend }) => {
	const run = prepareRun(backend)
	// A paused clock holds the two-second poll: only the stream can open the prompt.
	await page.clock.install()
	await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 1000)
	await start(page, backend)
	const reads = () => backend.requests.filter(request => request.path === "/run/run-one").length
	await expect.poll(reads).toBe(1)
	await expect.poll(() => run.streams.length).toBe(1)
	await replyBox(page).fill("Ready")
	await expect(send(page)).toBeDisabled()
	emit(run.streams[0], { type: "prompt_opened", sequence: 1, payload: { prompt_id: "p1", prompt: "Streamed question?", accepts_images: false } })
	await expect(output(page)).toHaveText("Streamed question?")
	await expect(send(page)).toBeEnabled()
	emit(run.streams[0], { type: "prompt_closed", sequence: 2, payload: { prompt_id: "p1", reason: "timed_out" } })
	await expect(output(page)).toHaveText("Agent is working...")
	await expect(send(page)).toBeDisabled()
	await expect(replyBox(page)).toHaveValue("Ready")
	expect(reads()).toBe(1)
	expect(replies(backend)).toHaveLength(0)
})

test("live output after an acknowledged reply streams instead of waiting for the completed message", async ({ desktop: { page }, backend }) => {
	const run = prepareRun(backend)
	let current = waiting()
	backend.handlers.set("GET /run/run-one", response => json(response, current))
	backend.handlers.set("POST /run/run-one/reply", response => {
		current = snapshot()
		json(response, { ok: true })
	})
	await start(page, backend)
	await expect(output(page)).toHaveText("Question p1")
	await replyBox(page).fill("Go on")
	await send(page).click()
	await expect(replyBox(page)).toHaveValue("")
	emit(run.streams[0], delta(1, "Streaming", 0))
	emit(run.streams[0], delta(2, " after reply", 1))
	await expect(output(page)).toHaveText("Streaming after reply")
	emit(run.streams[0], message(3, "Streaming after reply, done", "live"))
	await expect(output(page)).toHaveText("Streaming after reply, done")
})

test("an acknowledged reply clears the panel and shows the agent working in the streaming style", async ({ desktop: { page }, backend }) => {
	const run = prepareRun(backend)
	let current = waiting()
	backend.handlers.set("GET /run/run-one", response => json(response, current))
	backend.handlers.set("POST /run/run-one/reply", response => {
		current = snapshot()
		json(response, { ok: true })
	})
	await start(page, backend)
	const section = page.locator(".agent-hud__replySection")
	await expect(output(page)).toHaveText("Question p1")
	await expect(section).not.toHaveAttribute("data-streaming")
	await replyBox(page).fill("Go on")
	await send(page).click()
	await expect(output(page)).toHaveText("Agent is working...")
	await expect(section).toHaveAttribute("data-streaming")
	emit(run.streams[0], delta(1, "Answer", 0))
	await expect(output(page)).toHaveText("Answer")
	await expect(section).toHaveAttribute("data-streaming")
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
			.toContainText("Could not send your reply. Your draft has been kept.")
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
