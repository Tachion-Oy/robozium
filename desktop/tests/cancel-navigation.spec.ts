import { expect } from "@playwright/test"
import type { ServerResponse } from "node:http"
import { test, json, prepareRun, snapshot, message, start, openHistory, output, view, runStatus } from "./run-fixture"

for (const terminal of ["completed", "failed", "cancelled"]) {
	test(`${terminal} returns to overview and history remains explicitly accessible`, async ({ desktop: { page }, backend }) => {
		const run = prepareRun(backend)
		let status = "running"
		backend.handlers.set("GET /run/run-one", response => json(response, snapshot({
			status, message_trace: [message(1, "First message"), message(2, "Last message")],
		})))
		await start(page, backend)
		await page.clock.install()
		await page.getByRole("textbox", { name: "Reply", exact: true }).fill("Unsent draft")
		await page.getByRole("button", { name: "Jump to first agent message", exact: true }).click()
		status = terminal
		await page.clock.fastForward(2001)
		await expect(page.getByRole("heading", { name: "Runs Overview", exact: true })).toBeVisible()
		await expect(page.getByRole("button", { name: "existing-project", exact: true })).toBeFocused()
		await expect.poll(() => run.closed).toBe(run.streams.length)
		await openHistory(page)
		await expect(output(page)).toHaveText("First message")
		await expect(runStatus(page)).toContainText(terminal[0].toUpperCase() + terminal.slice(1))
		await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("Unsent draft")
		const reads = backend.requests.filter(request => request.path === "/run/run-one").length
		await page.clock.fastForward(30_000)
		await expect(page.getByRole("region", { name: "Current Run", exact: true })).toBeVisible()
		expect(backend.requests.filter(request => request.path === "/run/run-one")).toHaveLength(reads)
	})
}

test("completion after explicit navigation leaves the chosen view in place", async ({ desktop: { page }, backend }) => {
	const run = prepareRun(backend)
	await start(page, backend)
	await page.clock.install()
	await view(page, "Environment")
	backend.handlers.set("GET /run/run-one", response => json(response, snapshot({ status: "completed" })))
	await page.clock.fastForward(2001)
	await expect.poll(() => run.closed).toBeGreaterThan(0)
	await expect(page.getByRole("combobox", { name: /^HUD view:/ })).toHaveAttribute("title", "Environment")
	await view(page, "Current Run")
	await expect(runStatus(page)).toContainText("Completed")
})

for (const background of [false, true]) {
	test(`confirmed cancellation returns to overview once and retains draft/history; background=${background}`, async ({ desktop: { page }, backend }) => {
		prepareRun(backend)
		let projectStatus = background ? "running" : "awaiting_user_input"
		let status = projectStatus
		backend.handlers.set("GET /projects", response => json(response, [{
			slug: "existing-project", status: projectStatus, run_id: projectStatus === "dormant" ? null : "run-one",
		}]))
		backend.handlers.set("GET /run/run-one", response => json(response, snapshot({
			status, message_trace: [message(1, "Retained history"), message(2, "Later history")],
			current_prompt_id: status === "awaiting_user_input" ? "p1" : null,
			current_prompt: status === "awaiting_user_input" ? "Question" : null,
		})))
		let pending: ServerResponse | undefined
		backend.handlers.set("POST /projects/existing-project/cancel", response => { pending = response })
		await start(page, backend)
		await page.clock.install()
		if (background) {
			projectStatus = "syncing"
			status = "completed"
			await page.clock.fastForward(2001)
			await openHistory(page)
		}
		await page.getByRole("textbox", { name: "Reply", exact: true }).fill("Keep my draft")
		await page.getByRole("button", { name: "Cancel", exact: true }).click()
		await expect.poll(() => pending).toBeDefined()
		await expect(page.getByRole("button", { name: "Cancelling…", exact: true })).toBeVisible()
		projectStatus = "syncing"
		status = background ? "completed" : "cancelled"
		json(pending!, { ok: true })
		await page.clock.fastForward(2001)
		if (background) await expect(page.getByRole("region", { name: "Current Run", exact: true })).toBeVisible()
		else await expect(page.getByRole("heading", { name: "Runs Overview", exact: true })).toBeVisible()
		projectStatus = "dormant"
		await page.clock.fastForward(251)
		await expect(page.getByRole("heading", { name: "Runs Overview", exact: true })).toBeVisible()
		await expect(page.getByRole("button", { name: "existing-project", exact: true })).toBeFocused()
		await page.getByRole("button", { name: "Return to run", exact: true }).click()
		await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("Keep my draft")
		await page.getByRole("button", { name: "Jump to first agent message", exact: true }).click()
		await expect(output(page)).toHaveText("Retained history")
		await page.clock.fastForward(3001)
		await expect(page.getByRole("region", { name: "Current Run", exact: true })).toBeVisible()
		expect(backend.requests.filter(request => request.path.endsWith("/cancel"))).toHaveLength(1)
	})
}

for (const replacement of [false, true]) {
	test(`late cancellation cannot override explicit navigation; replacement run=${replacement}`, async ({ desktop: { page }, backend }) => {
		prepareRun(backend)
		let projectStatus = "running"
		backend.handlers.set("GET /projects", response => json(response, [
			{ slug: "existing-project", status: projectStatus, run_id: projectStatus === "dormant" ? null : "run-one" },
			{ slug: "other-project", status: "dormant", run_id: null },
		]))
		let pending: ServerResponse | undefined
		backend.handlers.set("POST /projects/existing-project/cancel", response => { pending = response })
		await start(page, backend)
		await page.clock.install()
		await page.getByRole("button", { name: "Cancel", exact: true }).click()
		await expect.poll(() => pending).toBeDefined()
		await view(page, replacement ? "Runs Overview" : "Environment")
		if (replacement) {
			prepareRun(backend, "replacement", "other-project")
			await page.getByRole("button", { name: "other-project", exact: true }).click()
			await page.getByRole("button", { name: "Start run", exact: true }).click()
			await expect(page.getByRole("status", { name: "Run status" })).toContainText("other-project")
		}
		projectStatus = "dormant"
		json(pending!, { ok: true })
		const reads = backend.requests.filter(request => request.path === "/projects").length
		await page.clock.fastForward(3001)
		await expect.poll(() => backend.requests.filter(request => request.path === "/projects").length).toBeGreaterThan(reads)
		await expect(page.getByRole("combobox", { name: /^HUD view:/ })).toHaveAttribute("title", replacement ? "Current Run" : "Environment")
	})
}
