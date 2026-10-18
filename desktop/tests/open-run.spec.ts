import { expect } from "@playwright/test"
import type { ServerResponse } from "node:http"
import { test, json, prepareRun, snapshot, view, runStatus } from "./run-fixture"

for (const status of ["running", "awaiting_user_input"]) {
	test(`${status} project opens its existing run without creation or a model change`, async ({ desktop: { page }, backend }) => {
		const run = prepareRun(backend)
		backend.handlers.set("GET /projects", response => json(response, [{ slug: "existing-project", status, run_id: "run-one" }]))
		// Opening a known run does not require a model for a new launch.
		backend.handlers.set("GET /models", response => json(response, { detail: "Models unavailable" }, 503))
		let pending: ServerResponse | undefined
		backend.handlers.set("GET /run/run-one", response => { pending = response })
		await backend.open()
		await page.getByRole("button", { name: "existing-project", exact: true }).click()
		await page.getByRole("button", { name: "Open run", exact: true }).click()
		await expect.poll(() => pending).toBeDefined()
		expect(run.streams).toHaveLength(0)
		backend.handlers.set("GET /run/run-one", response => json(response, snapshot({ status })))
		json(pending!, snapshot({ status }))
		await expect(runStatus(page)).toContainText(status === "running" ? "Running" : "Awaiting input")
		await expect.poll(() => run.streams.length).toBe(1)
		await page.getByRole("textbox", { name: "Reply", exact: true }).fill("Existing run draft")
		await view(page, "Runs Overview")
		await page.getByRole("button", { name: "Open run", exact: true }).click()
		await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("Existing run draft")
		expect(run.streams).toHaveLength(1)
		expect(backend.requests.filter(request => request.method === "POST")).toHaveLength(0)
	})
}

for (const [status, runId] of [["syncing", null], ["cancelling", "old-run"], ["running", null], ["dormant", "old-run"]]) {
	test(`launch waits for a confirmed dormant project: ${status}/${runId}`, async ({ desktop: { page }, backend }) => {
		backend.handlers.set("GET /projects", response => json(response, [{ slug: "existing-project", status, run_id: runId }]))
		await backend.open()
		await page.getByRole("button", { name: "existing-project", exact: true }).click()
		await expect(page.getByRole("button", { name: "Start run", exact: true })).toHaveAttribute("aria-disabled", "true")
		await page.getByRole("button", { name: "Start run", exact: true }).dispatchEvent("click")
		expect(backend.requests.filter(request => request.method === "POST")).toHaveLength(0)
	})
}
