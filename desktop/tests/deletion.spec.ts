import { expect } from "@playwright/test"
import type { ServerResponse } from "node:http"
import { test, json, prepareRun, snapshot, start, view, output, message, runStatus } from "./run-fixture"

const row = (slug: string, status = "dormant") => ({ slug, status, run_id: null })

test("deletion requires dormant status and a second activation; blur, Escape, navigation and status changes disarm it", async ({ desktop: { page }, backend }) => {
	let status = "running"
	backend.handlers.set("GET /projects", response => json(response, [row("existing-project", status)]))
	backend.handlers.set("DELETE /projects/existing-project", response => json(response, { ok: true }))
	await backend.open()
	await page.clock.install()
	const remove = page.getByRole("button", { name: "Delete existing-project", exact: true })
	for (const current of ["running", "awaiting_user_input", "syncing", "cancelling"]) {
		status = current
		await page.getByRole("button", { name: "Refresh", exact: true }).click()
		await expect(page.getByRole("list", { name: "Projects", exact: true })).toContainText(current.replaceAll("_", " "))
		await expect(remove).toBeDisabled()
	}
	status = "dormant"
	await page.getByRole("button", { name: "Refresh", exact: true }).click()
	await expect(remove).toBeEnabled()
	const confirm = page.getByRole("button", { name: "Confirm delete existing-project", exact: true })
	await remove.click(); await expect(confirm).toBeFocused()
	await confirm.press("Escape"); await expect(remove).toBeFocused()
	await remove.click(); await page.getByRole("textbox", { name: "Project name" }).focus()
	await expect(remove).toBeVisible()
	await remove.click(); await view(page, "Environment"); await view(page, "Runs Overview")
	await expect(remove).toBeVisible()
	await remove.click()
	status = "syncing"
	await page.clock.fastForward(3001)
	await expect(remove).toBeDisabled()
	expect(backend.requests.filter(request => request.method === "DELETE")).toHaveLength(0)
})

test("pending deletion survives polls, rejects duplicate actions and preserves unrelated selection", async ({ desktop: { page }, backend }) => {
	let rows = [row("existing-project"), row("next-project")]
	backend.handlers.set("GET /projects", response => json(response, rows))
	let pending: ServerResponse | undefined
	backend.handlers.set("DELETE /projects/existing-project", response => { pending = response })
	await backend.open()
	await page.clock.install()
	await page.getByRole("button", { name: "existing-project", exact: true }).click()
	await page.getByRole("textbox", { name: "Project name" }).fill("Existing project")
	await page.getByRole("button", { name: "Delete existing-project", exact: true }).click()
	await page.getByRole("button", { name: "Confirm delete existing-project", exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click() })
	await expect.poll(() => pending).toBeDefined()
	await expect(page.getByRole("button", { name: "Start run", exact: true })).toHaveAttribute("aria-disabled", "true")
	await expect(page.getByRole("button", { name: "Create project", exact: true })).toHaveAttribute("aria-disabled", "true")
	await page.getByRole("textbox", { name: "Project name" }).press("Enter")
	expect(backend.requests.filter(request => request.method === "POST" && request.path === "/projects")).toHaveLength(0)
	await page.clock.fastForward(3001)
	await expect(page.getByRole("button", { name: "Deleting existing-project", exact: true })).toBeDisabled()
	await page.getByRole("button", { name: "next-project", exact: true }).click()
	rows = [row("next-project")]
	json(pending!, { ok: true })
	await expect(page.getByRole("button", { name: "existing-project", exact: true })).toHaveCount(0)
	await expect(page.getByRole("button", { name: "next-project", exact: true })).toHaveAttribute("aria-pressed", "true")
	await expect(page.getByRole("button", { name: "next-project", exact: true })).toBeFocused()
	await expect(page.getByRole("button", { name: "Create project", exact: true })).toHaveAttribute("aria-disabled", "false")
	await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue("Existing project")
	expect(backend.requests.filter(request => request.method === "DELETE")).toHaveLength(1)
	await view(page, "Environment")
	await view(page, "Runs Overview")
	await expect(page.getByRole("combobox", { name: /^HUD view:/ })).toBeFocused()
})

test("deleting the selected current project's history disposes its session and keeps the draft", async ({ desktop: { page }, backend }) => {
	const run = prepareRun(backend)
	backend.handlers.set("GET /run/run-one", response => json(response, snapshot({ status: "completed" })))
	let rows = [row("existing-project")]
	backend.handlers.set("GET /projects", response => json(response, rows))
	backend.handlers.set("DELETE /projects/existing-project", response => { rows = []; json(response, { ok: true }) })
	await start(page, backend)
	await page.getByRole("textbox", { name: "Reply", exact: true }).fill("Retain across deletion")
	await view(page, "Runs Overview")
	await page.getByRole("button", { name: "Delete existing-project", exact: true }).click()
	await page.getByRole("button", { name: "Confirm delete existing-project", exact: true }).click()
	await expect(page.getByText("Selected project: None", { exact: true })).toBeVisible()
	await expect(page.getByRole("textbox", { name: "Project name" })).toBeFocused()
	await expect(page.getByRole("button", { name: "Return to run", exact: true })).toHaveCount(0)
	await expect.poll(() => run.closed).toBe(run.streams.length)
	// A fresh project/run reuses the single app-owned draft.
	backend.handlers.set("POST /projects", response => { rows = [row("existing-project")]; json(response, { slug: "existing-project" }) })
	await page.getByRole("textbox", { name: "Project name" }).fill("Existing project")
	await page.getByRole("button", { name: "Create project", exact: true }).click()
	await expect(page.getByRole("button", { name: "existing-project", exact: true })).toHaveAttribute("aria-pressed", "true")
	await page.getByRole("button", { name: "Start run", exact: true }).click()
	await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("Retain across deletion")
})

for (const outcome of ["conflict", "timeout-present", "timeout-absent", "malformed"] as const) {
	test(`deletion ${outcome} reconciles without repeating DELETE`, async ({ desktop: { page }, backend }) => {
		let present = true
		backend.handlers.set("GET /projects", response => json(response, present ? [row("existing-project")] : []))
		backend.handlers.set("DELETE /projects/existing-project", response => {
			if (outcome === "conflict") json(response, { detail: "Active run" }, 409)
			if (outcome === "malformed") json(response, { ok: false })
			if (outcome === "timeout-absent") present = false
		})
		await backend.open()
		await page.clock.install()
		await page.getByRole("button", { name: "existing-project", exact: true }).click()
		await page.getByRole("button", { name: "Delete existing-project", exact: true }).click()
		await page.getByRole("button", { name: "Confirm delete existing-project", exact: true }).click()
		await expect.poll(() => backend.requests.filter(request => request.method === "DELETE").length).toBe(1)
		if (outcome.startsWith("timeout")) await page.clock.fastForward(10_001)
		if (outcome === "timeout-absent") {
			await expect(page.getByRole("button", { name: "existing-project", exact: true })).toHaveCount(0)
			await expect(page.getByText("Selected project: None", { exact: true })).toBeVisible()
		} else {
			await expect(page.getByRole("alert")).toContainText(outcome === "conflict" ? "active work must finish" : outcome === "malformed" ? "acknowledge" : "timed out")
			await expect(page.getByRole("button", { name: "Delete existing-project", exact: true })).toBeEnabled()
			await expect(page.getByRole("button", { name: "existing-project", exact: true })).toHaveAttribute("aria-pressed", "true")
		}
		await page.clock.fastForward(30_000)
		expect(backend.requests.filter(request => request.method === "DELETE")).toHaveLength(1)
	})
}


test("a pending launch protects its captured project after selection changes and survives deletion of the old session", async ({ desktop: { page }, backend }) => {
	prepareRun(backend)
	backend.handlers.set("GET /run/run-one", response => json(response, snapshot({ status: "completed" })))
	let rows = [row("existing-project"), row("launch-target"), row("other-project")]
	backend.handlers.set("GET /projects", response => json(response, rows))
	backend.handlers.set("DELETE /projects/existing-project", response => {
		rows = rows.filter(project => project.slug !== "existing-project")
		json(response, { ok: true })
	})
	await start(page, backend)
	await page.getByRole("textbox", { name: "Reply", exact: true }).fill("Keep for next run")
	await view(page, "Runs Overview")
	prepareRun(backend, "next-run", "launch-target")
	let pending: ServerResponse | undefined
	backend.handlers.set("POST /run/create", (response, body) => {
		expect(body).toEqual({ project: "launch-target" })
		pending = response
	})
	await page.getByRole("button", { name: "launch-target", exact: true }).click()
	await page.getByRole("button", { name: "Start run", exact: true }).click()
	await expect.poll(() => pending).toBeDefined()
	await page.getByRole("button", { name: "other-project", exact: true }).click()
	await expect(page.getByRole("button", { name: "Delete launch-target", exact: true })).toBeDisabled()
	await page.getByRole("button", { name: "Delete existing-project", exact: true }).click()
	await page.getByRole("button", { name: "Confirm delete existing-project", exact: true }).click()
	await expect(page.getByRole("button", { name: "existing-project", exact: true })).toHaveCount(0)
	await expect(page.getByRole("button", { name: "Starting run…", exact: true })).toBeVisible()
	json(pending!, { run_id: "next-run" })
	await expect(runStatus(page)).toContainText("launch-target")
	await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("Keep for next run")
	await view(page, "Runs Overview")
	await expect(page.getByRole("button", { name: "other-project", exact: true })).toHaveAttribute("aria-pressed", "true")
})

test("deleting an unrelated project preserves the current session and draft", async ({ desktop: { page }, backend }) => {
	const run = prepareRun(backend)
	let rows = [row("existing-project", "running"), row("unrelated")]
	backend.handlers.set("GET /projects", response => json(response, rows))
	backend.handlers.set("GET /run/run-one", response => json(response, snapshot({ message_trace: [message(1, "Keep history")] })))
	backend.handlers.set("DELETE /projects/unrelated", response => { rows = rows.slice(0, 1); json(response, { ok: true }) })
	await start(page, backend)
	await page.getByRole("textbox", { name: "Reply", exact: true }).fill("Keep draft")
	await view(page, "Runs Overview")
	await page.getByRole("button", { name: "Delete unrelated", exact: true }).click()
	await page.getByRole("button", { name: "Confirm delete unrelated", exact: true }).click()
	await expect(page.getByRole("button", { name: "unrelated", exact: true })).toHaveCount(0)
	await page.getByRole("button", { name: "Return to run", exact: true }).click()
	await expect(output(page)).toHaveText("Keep history")
	await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("Keep draft")
	expect(run.streams).toHaveLength(1)
	expect(run.closed).toBe(0)
})
