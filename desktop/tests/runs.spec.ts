import { expect } from "@playwright/test"
import type { ServerResponse } from "node:http"
import { writeFile } from "node:fs/promises"
import { test, json, catalogue, project, prepareRun, snapshot, message, delta, emit, start, view, output, runStatus, launchButton, expectOverview } from "./run-fixture"
import { captureNative, chooseModel, modelTrigger, setNativeViewport } from "./native"
import { expectFooterGeometry } from "./footer-geometry"

test("launch requires a confirmed model, blocks overlapping writes and duplicate submissions", async ({ desktop: { page }, backend }) => {
	const run = prepareRun(backend)
	let models: ServerResponse | undefined
	let created: ServerResponse | undefined
	backend.handlers.set("GET /models", response => { models = response })
	backend.handlers.set("POST /run/create", (response, body) => { expect(body).toEqual({ project: "existing-project", capabilities: {} }); created = response })
	await backend.open()
	// The overview stays locked until the default model is confirmed.
	const launch = launchButton(page, "existing-project")
	await expect(launch).toBeDisabled()
	json(models!, catalogue)
	await expect(launch).toBeEnabled()
	let write: ServerResponse | undefined
	backend.handlers.set("POST /models", response => { write = response })
	const model = modelTrigger(page)
	await chooseModel(page, "Second model")
	await expect(launch).toBeDisabled()
	json(write!, { ...catalogue, selected_model_id: "two" })
	await expect(launch).toBeEnabled()
	await launch.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click() })
	await expect(page.locator(".agent-hud__project-row", { hasText: "existing-project" })).toContainText("OPENING")
	await expect(launch).toBeDisabled()
	await expect(model).toBeDisabled()
	await expect.poll(() => created).toBeDefined()
	expect(backend.requests.filter(request => request.path === "/run/create")).toHaveLength(1)
	json(created!, { run_id: "run-one" })
	await expect(runStatus(page)).toContainText("existing-project")
	await expect.poll(() => run.streams.length).toBe(1)
})

for (const [label, body, status] of [
	["rejection", { detail: "Already running" }, 409],
	["malformed identifier", { run_id: 42 }, 200],
	["empty identifier", { run_id: " " }, 200],
] as const) {
	test(`creation ${label} stays in overview without retrying`, async ({ desktop: { page }, backend }) => {
		backend.handlers.set("POST /run/create", response => json(response, body, status))
		await backend.open()
		await page.clock.install()
		const launch = launchButton(page, "existing-project")
		await launch.click()
		await expect(page.getByRole("alert")).toContainText("Launch failed")
		await expect(launch).toBeEnabled()
		await page.clock.fastForward(30_000)
		expect(backend.requests.filter(request => request.path === "/run/create")).toHaveLength(1)
		expect(backend.requests.filter(request => request.path.endsWith("/stream"))).toHaveLength(0)
	})
}

test("launch resolves saved capabilities, saves them, then creates the run with them", async ({ desktop: { page }, backend }) => {
	const run = prepareRun(backend)
	backend.handlers.set("GET /capabilities", response => json(response, [
		{ name: "base", kind: "tool", selectable: false, loading: null },
		{ name: "web", kind: "tool", selectable: true, loading: null },
		{ name: "notes", kind: "skill", selectable: true, loading: "automatic" },
	]))
	// Saved choices for capabilities that no longer exist are dropped.
	backend.handlers.set("GET /capabilities/existing-project", response => json(response, { web: true, notes: "on_demand", gone: true }))
	await backend.open()
	await launchButton(page, "existing-project").click()
	await expect(runStatus(page)).toContainText("existing-project")
	await expect.poll(() => run.streams.length).toBe(1)
	const selection = { web: true, notes: "on_demand" }
	const writes = backend.requests.filter(request => request.method === "POST")
	expect(writes.map(({ path, body }) => ({ path, body }))).toEqual([
		{ path: "/capabilities/existing-project", body: selection },
		{ path: "/run/create", body: { project: "existing-project", capabilities: selection } },
	])
	const order = backend.requests.map(request => `${request.method} ${request.path}`)
	expect(order.indexOf("POST /capabilities/existing-project")).toBeGreaterThan(order.indexOf("GET /capabilities/existing-project"))
})

for (const [label, handler, alert] of [
	["locked secrets", "POST /capabilities/existing-project", ["Secrets locked", "Unlock secrets before starting a run.", "Open the Secrets locked menu and enter your password."]],
	["an invalid selection", "POST /capabilities/existing-project", ["Launch failed", "API request failed (422): Invalid capability selection"]],
	["a malformed catalogue", "GET /capabilities", ["Launch failed", "The backend returned an invalid capability response."]],
] as const) {
	test(`launch reports ${label} and never repeats a write`, async ({ desktop: { page }, backend }) => {
		const status = label === "locked secrets" ? 423 : label === "an invalid selection" ? 422 : 200
		const body = status === 200 ? [{ name: "", kind: "tool", selectable: true, loading: null }] : { detail: "Invalid capability selection" }
		backend.handlers.set(handler, response => json(response, body, status))
		await backend.open()
		await page.clock.install()
		const launch = launchButton(page, "existing-project")
		await launch.click()
		await expect(page.getByRole("alert").locator("p")).toHaveText([...alert])
		await expect(launch).toBeEnabled()
		await page.clock.fastForward(30_000)
		expect(backend.requests.filter(request => request.method === "POST" && request.path.startsWith("/capabilities/")))
			.toHaveLength(handler.startsWith("POST") ? 1 : 0)
		expect(backend.requests.filter(request => request.path === "/run/create")).toHaveLength(0)
	})
}

test("a failed capability read aborts its unfinished sibling", async ({ desktop: { page }, backend }) => {
	let catalog: ServerResponse | undefined
	let saved: ServerResponse | undefined
	let savedClosed = false
	backend.handlers.set("GET /capabilities", response => { catalog = response })
	backend.handlers.set("GET /capabilities/existing-project", response => {
		saved = response
		response.on("close", () => { savedClosed = true })
	})
	await backend.open()
	await launchButton(page, "existing-project").click()
	await expect.poll(() => Boolean(catalog && saved)).toBe(true)
	json(catalog!, { detail: "Catalogue unavailable" }, 500)
	await expect(page.getByRole("alert")).toContainText("Launch failed")
	// The saved-selection read is aborted at once, not left to its deadline.
	await expect.poll(() => savedClosed, { timeout: 2000 }).toBe(true)
	expect(backend.requests.filter(request => request.method === "POST")).toHaveLength(0)
})

test("a project with an active run opens that run without launching", async ({ desktop: { page }, backend }) => {
	const run = prepareRun(backend)
	backend.handlers.set("GET /projects", response => json(response, [
		project("existing-project", { status: "running", run_id: "run-one", created_at: 1 }),
	]))
	await backend.open()
	await expect(launchButton(page, "existing-project")).toBeDisabled()
	await page.getByRole("button", { name: "Open existing-project", exact: true }).click()
	await expect(runStatus(page)).toContainText("existing-project")
	await expect.poll(() => run.streams.length).toBe(1)
	expect(backend.requests.filter(request => request.method === "POST")).toHaveLength(0)
	expect(backend.requests.filter(request => request.path.startsWith("/capabilities"))).toHaveLength(0)
})

test("creation deadlines abort the request and ignore late success", async ({ desktop: { page }, backend }) => {
	let pending: ServerResponse | undefined
	let closed = false
	backend.handlers.set("POST /run/create", response => { pending = response; response.on("close", () => { closed = true }) })
	await backend.open()
	await page.clock.install()
	await launchButton(page, "existing-project").click()
	await expect.poll(() => pending).toBeDefined()
	await page.clock.fastForward(10_001)
	await expect(page.getByRole("alert")).toContainText("Request timed out")
	await expect.poll(() => closed).toBe(true)
	json(pending!, { run_id: "late" })
	await page.clock.fastForward(30_000)
	expect(backend.requests.filter(request => request.path === "/run/create")).toHaveLength(1)
	await expect(page.getByRole("textbox", { name: "Reply text", exact: true })).toHaveCount(0)
})

test("late snapshots merge older history with newer SSE, deduplicate chunks and replace partial messages", async ({ desktop: { page }, backend }) => {
	const run = prepareRun(backend)
	let pending: ServerResponse | undefined
	backend.handlers.set("GET /run/run-one", response => { pending = response })
	await start(page, backend)
	await expect.poll(() => run.streams.length).toBe(1)
	const stream = run.streams[0]
	emit(stream, delta(3, '{"value":"Live'))
	emit(stream, delta(3, '{"value":"Live'))
	emit(stream, delta(4, " output", 1))
	emit(stream, delta(5, " output", 1)) // Same message/chunk under another sequence.
	await expect(output(page)).toHaveText("value:Live output")
	json(pending!, snapshot({ message_trace: [message(1, "First"), message(2, "Second")] }))
	await expect(output(page)).toHaveText("value:Live output")
	await page.getByRole("button", { name: "Jump to first agent message" }).click()
	await expect(output(page)).toHaveText("First")
	emit(stream, message(6, "Finished content", "live"))
	emit(stream, message(7, "Finished content", "live"))
	await expect(output(page)).toHaveText("First")
	await page.getByRole("button", { name: "Next agent message", exact: true }).click()
	await expect(output(page)).toHaveText("Second")
	await page.getByRole("button", { name: "Next agent message", exact: true }).click()
	await expect(output(page)).toHaveText("Finished content")
	await expect(page.getByRole("button", { name: "Next agent message", exact: true })).toBeDisabled()
	emit(stream, message(8, "Next notification"))
	await expect(output(page)).toHaveText("Next notification")
})

test("snapshots alone update prompts and terminal status, with serialized two-second polling", async ({ desktop: { page }, backend }) => {
	prepareRun(backend)
	const reads: ServerResponse[] = []
	backend.handlers.set("GET /run/run-one", response => reads.push(response))
	await page.clock.install()
	await start(page, backend)
	await expect.poll(() => reads.length).toBe(1)
	await page.clock.fastForward(6000)
	expect(reads).toHaveLength(1)
	json(reads[0], snapshot({ status: "awaiting_user_input", current_prompt_id: "p1", current_prompt: "First prompt" }))
	await expect(output(page)).toHaveText("First prompt")
	await expect(runStatus(page)).toContainText("Awaiting input")
	await page.clock.fastForward(2001)
	await expect.poll(() => reads.length).toBe(2)
	json(reads[1], snapshot({ status: "awaiting_user_input", current_prompt_id: "p2", current_prompt: "Second prompt" }))
	await expect(output(page)).toHaveText("Second prompt")
	await page.clock.fastForward(2001)
	await expect.poll(() => reads.length).toBe(3)
	json(reads[2], snapshot({ status: "completed", message_trace: [message(1, "Completed output")] }))
	await expectOverview(page)
	await page.clock.fastForward(30_000)
	expect(reads).toHaveLength(3)
})

test("view changes retain one session, project, history selection and draft; new runs dispose obsolete reads", async ({ desktop: { page }, backend }) => {
	const first = prepareRun(backend)
	backend.handlers.set("GET /projects", response => json(response, [project("existing-project"), project("second-project")]))
	await start(page, backend)
	await expect.poll(() => first.streams.length).toBe(1)
	emit(first.streams[0], message(1, "First")); emit(first.streams[0], message(2, "Second"))
	await expect(output(page)).toHaveText("Second")
	await page.getByRole("button", { name: "Previous agent message", exact: true }).click()
	await page.getByRole("textbox", { name: "Reply text", exact: true }).fill("Keep my draft")
	await view(page, "Environment"); await view(page, "Runs Overview")
	await expect(page.getByRole("button", { name: "Open second-project", exact: true })).toBeVisible()
	await view(page, "Current Run")
	await expect(output(page)).toHaveText("First")
	await expect(runStatus(page)).toContainText("existing-project")
	await expect(page.getByRole("textbox", { name: "Reply text", exact: true })).toHaveValue("Keep my draft")
	expect(first.streams).toHaveLength(1)
	let oldRead: ServerResponse | undefined
	let oldClosed = false
	backend.handlers.set("GET /run/run-one", response => { oldRead = response; response.on("close", () => { oldClosed = true }) })
	await expect.poll(() => oldRead).toBeDefined()
	const second = prepareRun(backend, "run-two", "second-project")
	await view(page, "Runs Overview")
	await launchButton(page, "second-project").click()
	await expect.poll(() => first.closed).toBe(1)
	await expect.poll(() => oldClosed).toBe(true)
	await expect.poll(() => second.streams.length).toBe(1)
	json(oldRead!, snapshot({ message_trace: [message(10, "OBSOLETE")] }))
	emit(second.streams[0], message(1, "New run"))
	await expect(output(page)).toHaveText("New run")
	await expect(runStatus(page)).toContainText("second-project")
	await expect(page.getByRole("textbox", { name: "Reply text", exact: true })).toHaveValue("Keep my draft")
	expect(backend.requests.filter(request => request.path.includes("cancel"))).toHaveLength(0)
	await page.goto("about:blank")
	await expect.poll(() => second.closed).toBe(1)
})

for (const end of ["closure", "409"] as const) {
	test(`stream ${end} waits for an in-flight read, takes a fresh snapshot and stops polling at completion`, async ({ desktop: { page }, backend }) => {
		const run = prepareRun(backend)
		const reads: ServerResponse[] = []
		backend.handlers.set("GET /run/run-one", response => reads.push(response))
		if (end === "409") backend.handlers.set("GET /run/run-one/stream", response => json(response, { detail: "Finished" }, 409))
		await page.clock.install()
		await start(page, backend)
		await expect.poll(() => reads.length).toBe(1)
		if (end === "closure") { await expect.poll(() => run.streams.length).toBe(1); run.streams[0].end() }
		await page.clock.fastForward(6000)
		expect(reads).toHaveLength(1)
		json(reads[0], snapshot({ message_trace: [message(1, "Before closure")] }))
		await expect.poll(() => reads.length).toBe(2)
		json(reads[1], snapshot({ status: "completed", message_trace: [message(1, "Before closure"), message(2, "Final output")] }))
		await expectOverview(page)
		await expect(page.getByRole("alert")).toHaveCount(0)
		await page.clock.fastForward(30_000)
		expect(reads).toHaveLength(2)
		expect(backend.requests.filter(request => request.path.endsWith("/stream"))).toHaveLength(1)
	})
}

for (const status of ["failed", "cancelled", "queued", "cancelling"] as const) {
	const ends = status === "failed" || status === "cancelled"
	test(`snapshot status ${status} ${ends ? "ends the run and returns to the overview" : "is presented"}`, async ({ desktop: { page }, backend }) => {
		const run = prepareRun(backend)
		backend.handlers.set("GET /run/run-one", response => json(response, snapshot({ status, message_trace: [message(1, "Kept output")], error: status === "failed" ? "Execution failed" : null })))
		await backend.open()
		await launchButton(page, "existing-project").click()
		if (ends) {
			await expectOverview(page)
			if (status === "failed") {
				await expect(page.getByRole("alert").locator("p")).toHaveText(["Run failed", 'Could not run "existing-project".', "Execution failed"])
			}
			await expect.poll(() => run.closed).toBe(run.streams.length)
			return
		}
		await expect(runStatus(page)).toContainText(status[0].toUpperCase() + status.slice(1))
		await expect(output(page)).toHaveText("Kept output")
	})
}

for (const invalid of ["snapshot", "event", "unknown"] as const) {
	test(`${invalid} run data preserves output and reports unavailable`, async ({ desktop: { page }, backend }) => {
		const run = prepareRun(backend)
		await start(page, backend)
		await expect.poll(() => run.streams.length).toBe(1)
		emit(run.streams[0], message(1, "Keep output"))
		await expect(output(page)).toHaveText("Keep output")
		if (invalid === "event") emit(run.streams[0], { type: "message_delta", sequence: 2, payload: { delta: 42 } })
		else backend.handlers.set("GET /run/run-one", response => json(response, invalid === "unknown" ? { detail: "unknown run_id" } : snapshot({ status: "nonsense" }), invalid === "unknown" ? 404 : 200))
		await expect.poll(() => run.closed).toBe(1)
		// A confirmed missing run returns to the overview; invalid data stays readable.
		if (invalid === "unknown") return await expectOverview(page)
		await expect(page.getByRole("alert")).toContainText("invalid run data")
		await expect(output(page)).toHaveText("Keep output")
	})
}

test("a snapshot deadline aborts the read and polling continues quietly", async ({ desktop: { page }, backend }) => {
	const run = prepareRun(backend)
	let pending: ServerResponse | undefined
	let closed = false
	backend.handlers.set("GET /run/run-one", response => { pending = response; response.on("close", () => { closed = true }) })
	await page.clock.install()
	await start(page, backend)
	await expect.poll(() => pending).toBeDefined()
	await page.clock.fastForward(10_001)
	await expect.poll(() => closed).toBe(true)
	backend.handlers.set("GET /run/run-one", response => json(response, snapshot({ status: "awaiting_user_input", current_prompt_id: "p1", current_prompt: "Still here" })))
	await page.clock.fastForward(2001)
	await expect(output(page)).toHaveText("Still here")
	await expect(page.getByRole("alert")).toHaveCount(0)
	expect(run.closed).toBe(0)
})

for (const theme of ["dark", "light"]) {
	test(`streaming scroll, empty history, clipboard and pinned selection fit ${theme} at narrow zoom`, async ({ desktop: { app, page }, backend }, testInfo) => {
		const run = prepareRun(backend)
		await start(page, backend)
		if (theme === "light") await page.getByRole("button", { name: "Toggle color theme" }).click()
		await setNativeViewport(app, page, 640, 420, 1.25)
		for (const button of await page.getByRole("group", { name: "Agent message history" }).getByRole("button").all()) await expect(button).toBeDisabled()
		await expect(page.getByRole("button", { name: "Copy agent output" })).toBeDisabled()
		await expect.poll(() => run.streams.length).toBe(1)
		const stream = run.streams[0]
		emit(stream, message(1, "Older\n".repeat(80)))
		emit(stream, delta(2, "Line\n".repeat(80)))
		await expect(output(page)).toContainText("Line")
		emit(stream, delta(3, "Last line", 1))
		await expect(output(page)).toContainText("Last line")
		const scroller = page.locator(".agent-hud__replyBox-scroll")
		await expect.poll(() => scroller.evaluate(element => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop) < 2)).toBe(true)
		await page.getByRole("button", { name: "Previous agent message", exact: true }).click()
		await expect(output(page)).toContainText("Older")
		await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
		emit(stream, delta(4, " More", 2))
		await expect(output(page)).toHaveText("Older\n".repeat(80))
		await page.getByRole("button", { name: "Copy agent output" }).click()
		expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe("Older\n".repeat(80))
		await expectFooterGeometry(page)
		const screenshot = testInfo.outputPath(`run-${theme}.png`)
		await writeFile(screenshot, (await captureNative(app, page, 640, 420))!)
		await testInfo.attach(`run-${theme}.png`, { path: screenshot, contentType: "image/png" })
	})
}

test("script output stays literal, groups chunks, and keeps a pinned identity across older snapshot recovery", async ({ desktop: { page, app }, backend }) => {
	const run = prepareRun(backend)
	let pending: ServerResponse | undefined
	backend.handlers.set("GET /run/run-one", response => { pending = response })
	await start(page, backend)
	await expect.poll(() => run.streams.length).toBe(1)
	const script = (sequence: number, content: string) => ({ type: "script_output", sequence, payload: { content } })
	emit(run.streams[0], script(2, '  {"literal": "value"}\n'))
	emit(run.streams[0], script(3, "second\n"))
	await expect(output(page)).toHaveText('  {"literal": "value"}\nsecond\n')
	emit(run.streams[0], message(4, "After script"))
	await expect(output(page)).toHaveText("After script")
	await page.getByRole("button", { name: "Previous agent message", exact: true }).click()
	json(pending!, snapshot({ message_trace: [message(0, "Earlier recovered history"), script(1, "Recovered prefix\n"), script(2, '  {"literal": "value"}\n'), script(3, "second\n"), message(4, "After script")] }))
	const expected = 'Recovered prefix\n  {"literal": "value"}\nsecond\n'
	await expect(output(page)).toHaveText(expected)
	emit(run.streams[0], message(5, "More output"))
	await expect(output(page)).toHaveText(expected)
	await page.getByRole("button", { name: "Copy agent output" }).click()
	expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(expected)
})

test("completed prompt messages extract user-facing text and late token deltas cannot replace them", async ({ desktop: { page }, backend }) => {
	const run = prepareRun(backend)
	backend.handlers.set("GET /run/run-one", response => json(response, snapshot({ message_trace: [{
		...message(5, JSON.stringify({ action: "prompt_user", rationale: "Ask", value: "Question?" }), "prompt-message"),
		payload: { role: "assistant", content: JSON.stringify({ action: "prompt_user", rationale: "Ask", value: "Question?" }) },
	}] })))
	await start(page, backend)
	await expect(output(page)).toHaveText("Question?")
	emit(run.streams[0], delta(4, "obsolete partial", 0, "prompt-message"))
	emit(run.streams[0], { type: "future_event", payload: {} })
	emit(run.streams[0], { ...message(6, "internal tool output"), payload: { role: "user", content: "internal tool output" } })
	await expect(output(page)).toHaveText("Question?")
	await expect(page.getByRole("button", { name: "Previous agent message", exact: true })).toBeDisabled()
})

test("retrying old output cannot cancel a pending replacement creation", async ({ desktop: { page, app }, backend }, testInfo) => {
	const run = prepareRun(backend)
	await start(page, backend)
	await expect.poll(() => run.streams.length).toBe(1)
	emit(run.streams[0], { type: "message_delta", sequence: 1, payload: { delta: 42 } })
	await expect(page.getByRole("button", { name: "Retry output" })).toBeEnabled()
	let pending: ServerResponse | undefined
	prepareRun(backend, "replacement")
	backend.handlers.set("POST /run/create", response => { pending = response })
	await view(page, "Runs Overview")
	await launchButton(page, "existing-project").click()
	await expect.poll(() => pending).toBeDefined()
	await view(page, "Current Run")
	await expect(page.getByRole("button", { name: "Retry output" })).toBeDisabled()
	json(pending!, { run_id: "replacement" })
	await expect(page.getByRole("alert")).toHaveCount(0)
	await view(page, "Runs Overview")
	await expect(launchButton(page, "existing-project")).toBeEnabled()
	expect(backend.requests.filter(request => request.path === "/run/create")).toHaveLength(2)
	await setNativeViewport(app, page, 640, 420, 1.25)
	await testInfo.attach("overview-actions.png", { body: (await captureNative(app, page, 640, 420))!, contentType: "image/png" })
})

test("provider retries discard abandoned text while keeping completed history and drafts", async ({ desktop: { page }, backend }) => {
	const run = prepareRun(backend)
	await page.clock.install()
	await start(page, backend)
	await expect.poll(() => run.streams.length).toBe(1)
	const stream = run.streams[0]
	const retry = { type: "runtime_event", sequence: 3, payload: { category: "llm", kind: "retrying", agent_name: "orchestrator" } }
	emit(stream, message(1, "Earlier"))
	emit(stream, delta(2, "Abandoned attempt", 0, "attempt-1"))
	await expect(output(page)).toHaveText("Abandoned attempt")
	await page.getByRole("textbox", { name: "Reply text", exact: true }).fill("Keep this draft")
	emit(stream, retry)
	await expect(output(page)).toHaveText("Agent is working...")
	emit(stream, delta(4, "Successful", 0, "attempt-2"))
	emit(stream, message(5, "Successful response", "attempt-2"))
	await expect(output(page)).toHaveText("Successful response")
	backend.handlers.set("GET /run/run-one", response => json(response, snapshot({
		message_trace: [message(1, "Earlier"), retry, message(5, "Successful response", "attempt-2")],
	})))
	await page.clock.fastForward(2001)
	await page.getByRole("button", { name: "Previous agent message", exact: true }).click()
	await expect(output(page)).toHaveText("Earlier")
	await expect(page.getByRole("button", { name: "Previous agent message", exact: true })).toBeDisabled()
	await expect(page.getByRole("textbox", { name: "Reply text", exact: true })).toHaveValue("Keep this draft")
})

test("active prompts stay visible before later notifications and latest navigation returns to the prompt", async ({ desktop: { page }, backend }) => {
	const run = prepareRun(backend)
	const history = [message(1, "Earlier"), message(2, "Continue?"), message(3, "Background")]
	backend.handlers.set("GET /run/run-one", response => json(response, snapshot({
		status: "awaiting_user_input", current_prompt_id: "p1", current_prompt: "Continue?", message_trace: history,
	})))
	await page.clock.install()
	await start(page, backend)
	await expect(output(page)).toHaveText("Continue?")
	await expect.poll(() => run.streams.length).toBe(1)
	await expect(page.getByRole("button", { name: "Jump to latest agent message" })).toBeDisabled()
	await page.getByRole("button", { name: "Next agent message", exact: true }).click()
	await expect(output(page)).toHaveText("Background")
	emit(run.streams[0], message(4, "More background output"))
	await expect(output(page)).toHaveText("Background")
	await page.getByRole("button", { name: "Jump to latest agent message" }).click()
	await expect(output(page)).toHaveText("Continue?")
	await page.getByRole("button", { name: "Previous agent message", exact: true }).click()
	await expect(output(page)).toHaveText("Earlier")
	backend.handlers.set("GET /run/run-one", response => json(response, snapshot({
		status: "awaiting_user_input", current_prompt_id: "p2", current_prompt: "Next question?", message_trace: history,
	})))
	await page.clock.fastForward(2001)
	await expect(output(page)).toHaveText("Earlier")
	await page.getByRole("button", { name: "Jump to latest agent message" }).click()
	await expect(output(page)).toHaveText("Next question?")
})

test("ordinary completion keeps progress visible through polling until a prompt replaces it", async ({ desktop: { page }, backend }) => {
	const run = prepareRun(backend)
	await page.clock.install()
	await start(page, backend)
	await expect.poll(() => run.streams.length).toBe(1)
	emit(run.streams[0], delta(1, '{"action":"working"', 0, "tool"))
	await expect(output(page)).toHaveText("action:working")
	const completed = { type: "message", sequence: 2, message_id: "tool",
		payload: { role: "assistant", content: '{"action":"tool","value":"work"}' } }
	emit(run.streams[0], completed)
	backend.handlers.set("GET /run/run-one", response => json(response, snapshot({ message_trace: [completed] })))
	await page.clock.fastForward(2001)
	await expect(output(page)).toHaveText("action:working")
	await expect(page.getByRole("button", { name: "Copy agent output" })).toBeEnabled()
	await expect(page.getByRole("button", { name: "Previous agent message", exact: true })).toBeDisabled()
	backend.handlers.set("GET /run/run-one", response => json(response, snapshot({
		status: "awaiting_user_input", current_prompt_id: "p1", current_prompt: "Continue?", message_trace: [completed],
	})))
	await page.clock.fastForward(2001)
	await expect(output(page)).toHaveText("Continue?")
})

test("prefix recovery followed by a split keeps both script entries navigable and copyable", async ({ desktop: { page, app }, backend }) => {
	const run = prepareRun(backend)
	const reads: ServerResponse[] = []
	backend.handlers.set("GET /run/run-one", response => reads.push(response))
	const script = (sequence: number, content: string) => ({ type: "script_output", sequence, payload: { content } })
	await page.clock.install()
	await start(page, backend)
	await expect.poll(() => run.streams.length).toBe(1)
	await expect.poll(() => reads.length).toBe(1)
	emit(run.streams[0], script(4, "Later"))
	emit(run.streams[0], message(8, "Latest"))
	await expect(output(page)).toHaveText("Latest")
	await page.getByRole("button", { name: "Previous agent message", exact: true }).click()
	json(reads[0], snapshot({ message_trace: [script(2, "Prefix")] }))
	await expect(output(page)).toHaveText("PrefixLater")
	await page.clock.fastForward(2001)
	await expect.poll(() => reads.length).toBe(2)
	json(reads[1], snapshot({ message_trace: [{ type: "run_lifecycle", payload: { sequence: 3, kind: "started", agent_name: "root" } }] }))
	await expect(output(page)).toHaveText("Later")
	await page.getByRole("button", { name: "Previous agent message", exact: true }).click()
	await expect(output(page)).toHaveText("Prefix")
	await page.getByRole("button", { name: "Copy agent output" }).click()
	expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe("Prefix")
	await page.getByRole("button", { name: "Next agent message", exact: true }).click()
	await expect(output(page)).toHaveText("Later")
	await page.getByRole("button", { name: "Copy agent output" }).click()
	expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe("Later")
})

test("a duplicate script event dismisses delayed tokens and continues the recovered script", async ({ desktop: { page, app }, backend }) => {
	const run = prepareRun(backend)
	const script = (sequence: number, content: string) => ({ type: "script_output", sequence, payload: { content } })
	backend.handlers.set("GET /run/run-one", response => json(response, snapshot({ message_trace: [script(6, "Newer script output")] })))
	await start(page, backend)
	await expect(output(page)).toHaveText("Newer script output")
	await expect.poll(() => run.streams.length).toBe(1)
	emit(run.streams[0], delta(5, "Older LLM text"))
	await expect(output(page)).toHaveText("Older LLM text")
	emit(run.streams[0], script(6, "Newer script output"))
	await expect(output(page)).toHaveText("Newer script output")
	emit(run.streams[0], script(7, " continued"))
	await expect(output(page)).toHaveText("Newer script output continued")
	await expect(page.getByRole("button", { name: "Previous agent message", exact: true })).toBeDisabled()
	await page.getByRole("button", { name: "Copy agent output" }).click()
	expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe("Newer script output continued")
})

test("a prompt separates pinned script output through dismissal and later history recovery", async ({ desktop: { page, app }, backend }) => {
	const run = prepareRun(backend)
	const reads: ServerResponse[] = []
	backend.handlers.set("GET /run/run-one", response => reads.push(response))
	const script = (sequence: number, content: string) => ({ type: "script_output", sequence, payload: { content } })
	await page.clock.install()
	await start(page, backend)
	await expect.poll(() => run.streams.length).toBe(1)
	await expect.poll(() => reads.length).toBe(1)
	emit(run.streams[0], script(2, "Before"))
	await expect(output(page)).toHaveText("Before")
	json(reads[0], snapshot({ status: "awaiting_user_input", current_prompt_id: "p1", current_prompt: "Continue?", message_trace: [script(2, "Before")] }))
	await expect(output(page)).toHaveText("Continue?")
	await page.getByRole("button", { name: "Previous agent message", exact: true }).click()
	await page.getByRole("textbox", { name: "Reply text", exact: true }).fill("Retained draft")
	await page.clock.fastForward(2001)
	await expect.poll(() => reads.length).toBe(2)
	json(reads[1], snapshot({ message_trace: [script(2, "Before")] }))
	await expect(runStatus(page)).toContainText("Running")
	emit(run.streams[0], script(4, "After"))
	await expect(page.getByRole("button", { name: "Next agent message", exact: true })).toBeEnabled()
	await expect(output(page)).toHaveText("Before")
	await page.getByRole("button", { name: "Copy agent output" }).click()
	expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe("Before")
	await page.clock.fastForward(2001)
	await expect.poll(() => reads.length).toBe(3)
	json(reads[2], snapshot({ message_trace: [script(1, "Prefix"), script(2, "Before"), script(4, "After")] }))
	await expect(output(page)).toHaveText("PrefixBefore")
	await page.getByRole("button", { name: "Next agent message", exact: true }).click()
	await expect(output(page)).toHaveText("After")
	emit(run.streams[0], script(5, " continued"))
	await expect(output(page)).toHaveText("After continued")
	await expect(page.getByRole("textbox", { name: "Reply text", exact: true })).toHaveValue("Retained draft")
})

test("agent Markdown renders sanitized and its links open outside the window", async ({ desktop: { app, page }, backend }) => {
	await app.evaluate(({ shell }) => {
		const opened: string[] = []
		Reflect.set(globalThis, "openedLinks", opened)
		shell.openExternal = async url => { opened.push(url) }
	})
	const run = prepareRun(backend)
	await start(page, backend)
	await expect.poll(() => run.streams.length).toBe(1)
	emit(run.streams[0], message(1, [
		"# Report",
		"**Bold** and `code`.",
		"[External](https://example.invalid/page) and <file src=\"notes/report.txt\">the report</file>.",
		"<img src=x onerror=\"document.title='injected'\">",
	].join("\n\n")))
	const agent = page.locator(".agent-hud__replyBox--agent")
	await expect(agent.getByRole("heading", { name: "Report" })).toBeVisible()
	await expect(agent.locator("strong")).toHaveText("Bold")
	// The image keeps its source but loses the handler.
	await expect(agent).toContainText("Image — Image unavailable")
	const url = page.url()
	// Main opens the target outside the window, which never navigates.
	for (const name of ["External", "the report"]) {
		await agent.getByRole("link", { name, exact: true }).click()
		expect(page.url()).toBe(url)
		expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
	}
	await expect.poll(() => app.evaluate(() => Reflect.get(globalThis, "openedLinks"))).toEqual(["https://example.invalid/page"])
	await expect(agent.getByRole("link", { name: "the report", exact: true })).toHaveAttribute("href", "notes/report.txt")
	// A launch given a backend has no hub of its own to open files from.
	await expect(page.getByRole("alert").filter({ hasText: "Could not open link" }))
		.toContainText("This launch uses a backend it does not manage.")
	expect(await page.title()).not.toBe("injected")
})
