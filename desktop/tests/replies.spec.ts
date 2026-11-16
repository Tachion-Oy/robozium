import { expect, type Page } from "@playwright/test"
import type { ServerResponse } from "node:http"
import { test, json, project, prepareRun, snapshot, start, output, view, replyBox, launchButton, runStatus, delta, emit, message } from "./run-fixture"
import type { Backend } from "./selection-fixture"
import { toast } from "./native"

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

test("a wait with an empty prompt keeps the last output, shows its cause as a toast and takes a reply", async ({ desktop: { page }, backend }) => {
	const run = prepareRun(backend)
	const history = [message(1, "Latest output")]
	let current = waiting("p1", { message_trace: history })
	backend.handlers.set("GET /run/run-one", response => json(response, current))
	const sent: unknown[] = []
	backend.handlers.set("POST /run/run-one/reply", (response, body) => {
		sent.push(body)
		current = snapshot({ message_trace: history })
		json(response, { ok: true })
	})
	await start(page, backend)
	await replyBox(page).fill("Go on")
	await send(page).click()
	emit(run.streams[0], delta(2, "Half an ans", 0))
	await expect(output(page)).toHaveText("Half an ans")
	// The model call fails: the backend explains it in a notice and waits with an empty prompt.
	const cause = "The request to openrouter/z-ai/glm-5.3 failed: the provider account does not have enough credit for it."
	emit(run.streams[0], { type: "runtime_event", sequence: 3, payload: { category: "llm", kind: "failed", level: "error", agent_name: "orchestrator", message: cause } })
	current = waiting("p2", { current_prompt: "", message_trace: history })
	await expect(toast(page, "Runtime error")).toContainText(cause)
	await expect(output(page)).toHaveText("Latest output")
	await replyBox(page).fill("retry")
	await replyBox(page).press("Enter")
	await expect.poll(() => sent).toEqual([{ prompt_id: "p1", content: "Go on" }, { prompt_id: "p2", content: "retry" }])
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

test("opening another run aborts a pending reply, empties the reply box and ignores the late answer", async ({ desktop: { page }, backend }) => {
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
	await replyBox(page).fill("Earlier run's reply")
	await send(page).click()
	await expect.poll(() => pending).toBeDefined()
	prepareRun(backend, "next-run", "next-project")
	backend.handlers.set("GET /run/next-run", response => json(response, waiting("p2", { project: "next-project" })))
	await view(page, "Runs Overview")
	await launchButton(page, "next-project").click()
	await expect(output(page)).toHaveText("Question p2")
	await expect(replyBox(page)).toHaveValue("")
	await expect.poll(() => aborted).toBe(true)
	await expect.poll(() => previous.closed).toBe(previous.streams.length)
	await replyBox(page).fill("Next run's reply")
	json(pending!, { ok: true })
	await expect(replyBox(page)).toHaveValue("Next run's reply")
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
