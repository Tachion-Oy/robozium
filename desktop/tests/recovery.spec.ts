import { expect } from "@playwright/test"
import type { ServerResponse } from "node:http"
import { test, json, prepareRun, snapshot, message, start, output, view, runStatus } from "./run-fixture"
import { recoveryKey } from "../renderer/src/recovery/recovery-storage"

const key = recoveryKey("mock")

test("reload restores a draft and existing run after validation without repeating creation", async ({ desktop: { page }, backend }) => {
	const run = prepareRun(backend)
	backend.handlers.set("GET /run/run-one", response => json(response, snapshot({ message_trace: [message(1, "Recovered history")] })))
	await start(page, backend)
	await page.getByRole("textbox", { name: "Reply", exact: true }).fill("Keep across reload")
	await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).draft, key)).toBe("Keep across reload")
	const before = backend.requests.length
	await page.reload()
	await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("Keep across reload")
	await expect(output(page)).toHaveText("Recovered history")
	await expect.poll(() => run.streams.length).toBe(2)
	await expect.poll(() => run.closed).toBe(1)
	const requests = backend.requests.slice(before).filter(request => request.path.startsWith("/run/"))
	expect(requests[0].path).toBe("/run/run-one")
	expect(backend.requests.filter(request => request.path === "/run/create")).toHaveLength(1)
	await view(page, "Runs Overview")
	await expect(page.getByRole("button", { name: "existing-project", exact: true })).toHaveAttribute("aria-pressed", "true")
})

test("an active recovered run returns to overview when it later completes", async ({ desktop: { page }, backend }) => {
	prepareRun(backend)
	await start(page, backend)
	await page.getByRole("textbox", { name: "Reply", exact: true }).fill("Recovered draft")
	await page.reload()
	await expect(runStatus(page)).toContainText("Running")
	await page.clock.install()
	backend.handlers.set("GET /run/run-one", response => json(response, snapshot({ status: "completed" })))
	await page.clock.fastForward(2001)
	await expect(page.getByRole("heading", { name: "Runs Overview", exact: true })).toBeVisible()
	await page.getByRole("button", { name: "Return to run", exact: true }).click()
	await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("Recovered draft")
})

test("terminal recovery opens readable history without a stream or polling", async ({ desktop: { page }, backend }) => {
	const run = prepareRun(backend)
	await start(page, backend)
	await page.getByRole("textbox", { name: "Reply", exact: true }).fill("Unsent")
	backend.handlers.set("GET /run/run-one", response => json(response, snapshot({ status: "completed", message_trace: [message(1, "Completed history")] })))
	const before = run.streams.length
	await page.reload()
	await expect(output(page)).toHaveText("Completed history")
	await expect(runStatus(page)).toContainText("Completed")
	await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("Unsent")
	const requests = backend.requests.filter(request => request.path.startsWith("/run/")).length
	await page.clock.install()
	await page.clock.fastForward(30_000)
	expect(run.streams).toHaveLength(before)
	expect(backend.requests.filter(request => request.path.startsWith("/run/"))).toHaveLength(requests)
})

for (const projectDeleted of [false, true]) {
	test(`missing run returns to overview, forgets its ID and retains the draft; deleted project=${projectDeleted}`, async ({ desktop: { page }, backend }) => {
		prepareRun(backend)
		await start(page, backend)
		await page.getByRole("textbox", { name: "Reply", exact: true }).fill("Recovery draft")
		backend.handlers.set("GET /run/run-one", response => json(response, { detail: "unknown run_id" }, 404))
		if (projectDeleted) backend.handlers.set("GET /projects", response => json(response, []))
		await page.reload()
		await expect(page.getByRole("heading", { name: "Runs Overview", exact: true })).toBeVisible()
		await expect(page.getByRole("status", { name: "Run recovery" })).toContainText("no longer available")
		await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key)).toEqual({
			version: 1, selectedProject: projectDeleted ? "" : "existing-project", run: null, draft: "Recovery draft",
		})
		const reads = backend.requests.filter(request => request.path.startsWith("/run/")).length
		await page.clock.install()
		await page.clock.fastForward(30_000)
		expect(backend.requests.filter(request => request.path.startsWith("/run/"))).toHaveLength(reads)
		await page.reload()
		await expect(page.getByRole("heading", { name: "Runs Overview", exact: true })).toBeVisible()
		expect(backend.requests.filter(request => request.path.startsWith("/run/"))).toHaveLength(reads)
		if (projectDeleted) {
			await expect(page.getByText("Selected project: None", { exact: true })).toBeVisible()
			await expect(page.getByRole("button", { name: "Start run", exact: true })).toHaveAttribute("aria-disabled", "true")
		} else {
			prepareRun(backend, "explicit-new-run")
			expect(backend.requests.filter(request => request.path === "/run/create")).toHaveLength(1)
			await page.getByRole("button", { name: "Start run", exact: true }).click()
			await expect.poll(() => backend.requests.filter(request => request.path === "/run/create").length).toBe(2)
			await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("Recovery draft")
		}
	})
}

test("temporary recovery failure retains the run identity and reconnects without creation", async ({ desktop: { page }, backend }) => {
	prepareRun(backend)
	await backend.open()
	await page.evaluate(key => localStorage.setItem(key, JSON.stringify({
		version: 1, selectedProject: "existing-project", draft: "Outage draft",
		run: { id: "run-one", project: "existing-project" },
	})), key)
	let attempts = 0
	let retry: ServerResponse | undefined
	let recovered = false
	backend.handlers.set("GET /run/run-one", response => {
		if (attempts++ === 0) json(response, { detail: "Temporarily unavailable" }, 503)
		else if (!recovered) retry = response
		else json(response, snapshot())
	})
	await page.reload()
	await expect(page.getByRole("alert")).toContainText("Temporarily unavailable")
	await expect(page.getByRole("combobox", { name: /^HUD view:/ })).toHaveAttribute("title", "Current Run")
	await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).run, key)).toEqual({
		id: "run-one", project: "existing-project",
	})
	await expect.poll(() => retry).toBeDefined()
	recovered = true
	json(retry!, snapshot())
	await expect(runStatus(page)).toContainText("Running")
	await expect(page.getByRole("alert")).toHaveCount(0)
	await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("Outage draft")
	expect(backend.requests.filter(request => request.path === "/run/create")).toHaveLength(0)
})

test("a missing run disposes pending replies without restoring its recovery reference", async ({ desktop: { page }, backend }) => {
	const run = prepareRun(backend)
	backend.handlers.set("GET /run/run-one", response => json(response, snapshot({
		status: "awaiting_user_input", current_prompt_id: "p1", current_prompt: "Question",
	})))
	let pending: ServerResponse | undefined
	let disposed = false
	backend.handlers.set("POST /run/run-one/reply", response => {
		pending = response
		response.on("close", () => { disposed = true })
	})
	await start(page, backend)
	await page.clock.install()
	const editor = page.getByRole("textbox", { name: "Reply", exact: true })
	await editor.fill("Keep this answer")
	await editor.press("Enter")
	await expect.poll(() => pending).toBeDefined()
	backend.handlers.set("GET /run/run-one", response => json(response, { detail: "unknown run_id" }, 404))
	await page.clock.fastForward(2001)
	await expect(page.getByRole("status", { name: "Run recovery" })).toBeVisible()
	await expect.poll(() => disposed).toBe(true)
	await expect.poll(() => run.closed).toBe(run.streams.length)
	json(pending!, { detail: "Run stopped" }, 409)
	await page.getByRole("button", { name: "Return to run", exact: true }).click()
	await expect(editor).toHaveValue("Keep this answer")
	await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled()
	await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key)).toEqual({
		version: 1, selectedProject: "existing-project", run: null, draft: "Keep this answer",
	})
	const reads = backend.requests.filter(request => request.path === "/run/run-one").length
	await page.reload()
	await expect(page.getByRole("heading", { name: "Runs Overview", exact: true })).toBeVisible()
	expect(backend.requests.filter(request => request.path === "/run/run-one")).toHaveLength(reads)
	expect(backend.requests.filter(request => request.path.endsWith("/reply"))).toHaveLength(1)
})

test("a delayed missing-run result preserves explicit navigation and local history", async ({ desktop: { page }, backend }) => {
	prepareRun(backend)
	backend.handlers.set("GET /run/run-one", response => json(response, snapshot({ message_trace: [message(1, "Retained history")] })))
	await start(page, backend)
	await expect(output(page)).toHaveText("Retained history")
	await page.getByRole("textbox", { name: "Reply", exact: true }).fill("Retained draft")
	await page.clock.install()
	let pending: ServerResponse | undefined
	backend.handlers.set("GET /run/run-one", response => { pending = response })
	await page.clock.fastForward(2001)
	await expect.poll(() => pending).toBeDefined()
	await view(page, "Environment")
	json(pending!, { detail: "unknown run_id" }, 404)
	await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).run, key)).toBeNull()
	await expect(page.getByRole("combobox", { name: /^HUD view:/ })).toHaveAttribute("title", "Environment")
	await view(page, "Runs Overview")
	await expect(page.getByRole("status", { name: "Run recovery" })).toContainText("existing-project")
	await page.getByRole("button", { name: "Return to run", exact: true }).click()
	await expect(output(page)).toHaveText("Retained history")
	await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("Retained draft")
	await page.clock.fastForward(30_000)
	await expect(page.getByRole("region", { name: "Current Run", exact: true })).toBeVisible()
	expect(backend.requests.filter(request => request.path === "/run/create")).toHaveLength(1)
})

for (const data of ["{broken", '{"version":2}', '{"version":1,"selectedProject":"p","draft":42,"run":null}']) {
	test(`invalid recovery is reported and ignored: ${data}`, async ({ desktop: { page }, backend }) => {
		await backend.open()
		await page.evaluate(({ key, data }) => localStorage.setItem(key, data), { key, data })
		await page.reload()
		await expect(page.getByRole("alert")).toContainText("Saved recovery data could not be read")
		await expect(page.getByRole("heading", { name: "Runs Overview" })).toBeVisible()
		expect(backend.requests.filter(request => request.path.startsWith("/run/"))).toHaveLength(0)
	})
}

test("storage failure reports an error and leaves the current draft usable", async ({ desktop: { page }, backend }) => {
	prepareRun(backend)
	await start(page, backend)
	await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException("Full", "QuotaExceededError") } })
	const editor = page.getByRole("textbox", { name: "Reply", exact: true })
	await editor.fill("Keep in memory")
	await expect(page.getByRole("alert")).toContainText("Recovery data could not be saved")
	await editor.fill("Still editable")
	await expect(editor).toHaveValue("Still editable")
})

test("live and mock recovery records remain separate in the same Electron profile", async ({ desktop: { page }, backend }) => {
	prepareRun(backend)
	await start(page, backend)
	await page.getByRole("textbox", { name: "Reply", exact: true }).fill("Mock draft")
	await backend.open("live")
	await expect(page.getByText("Selected project: None", { exact: true })).toBeVisible()
	prepareRun(backend, "live-run")
	await page.getByRole("button", { name: "existing-project", exact: true }).click()
	await page.getByRole("button", { name: "Start run", exact: true }).click()
	await page.getByRole("textbox", { name: "Reply", exact: true }).fill("Live draft")
	await backend.open("mock")
	await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("Mock draft")
	await backend.open("live")
	await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("Live draft")
	expect(backend.requests.filter(request => request.path === "/run/create")).toHaveLength(2)
})

test("confirmed deletion removes saved project/run references but retains the draft", async ({ desktop: { page }, backend }) => {
	prepareRun(backend)
	backend.handlers.set("GET /run/run-one", response => json(response, snapshot({ status: "completed" })))
	backend.handlers.set("DELETE /projects/existing-project", response => {
		backend.handlers.set("GET /projects", response => json(response, []))
		json(response, { ok: true })
	})
	await start(page, backend, { history: true })
	await page.getByRole("textbox", { name: "Reply", exact: true }).fill("Retained without project")
	await view(page, "Runs Overview")
	await page.getByRole("button", { name: "Delete existing-project", exact: true }).click()
	await page.getByRole("button", { name: "Confirm delete existing-project", exact: true }).click()
	await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key)).toEqual({
		version: 1, selectedProject: "", run: null, draft: "Retained without project",
	})
	const before = backend.requests.filter(request => request.path.startsWith("/run/")).length
	await page.reload()
	await expect(page.getByRole("heading", { name: "Runs Overview" })).toBeVisible()
	expect(backend.requests.filter(request => request.path.startsWith("/run/"))).toHaveLength(before)
})
