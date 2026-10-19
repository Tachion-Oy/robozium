import { expect, type Page } from "@playwright/test"
import type { ServerResponse } from "node:http"
import { test, json, project, prepareRun, snapshot, start, view, replyBox, runStatus, expectOverview } from "./run-fixture"
import type { Backend } from "./selection-fixture"

const interruptButton = (page: Page) => page.locator(".agent-hud__interrupt")
const cancelButton = (page: Page) => page.locator(".agent-hud__cancel")
const send = (page: Page) => page.locator(".agent-hud__send")
const posts = (backend: Backend, suffix: string) => backend.requests.filter(request => request.method === "POST" && request.path.endsWith(suffix))
const alert = (page: Page, title: string) => page.getByRole("alert").filter({ hasText: title })
const row = (page: Page, slug: string) => page.locator(".agent-hud__project-row", { hasText: slug })

test("Interrupt is offered only while the agent works and stays pending until it asks", async ({ desktop: { page }, backend }) => {
	prepareRun(backend)
	let current = snapshot()
	backend.handlers.set("GET /run/run-one", response => json(response, current))
	let pending: ServerResponse | undefined
	backend.handlers.set("POST /run/run-one/interrupt", response => { pending = response })
	await page.clock.install()
	await start(page, backend)
	await expect(interruptButton(page)).toBeEnabled()
	await interruptButton(page).click()
	await expect(interruptButton(page)).toHaveText("Interrupting...")
	await expect(interruptButton(page)).toBeDisabled()
	await expect(send(page)).toBeDisabled()
	json(pending!, { ok: true })
	// An accepted interruption stays pending while snapshots still show the agent working.
	await page.clock.fastForward(2001)
	await expect(interruptButton(page)).toHaveText("Interrupting...")
	current = snapshot({ status: "awaiting_user_input", current_prompt_id: "p1", current_prompt: "Interrupted. What next?" })
	await page.clock.fastForward(2001)
	await expect(interruptButton(page)).toHaveText("Interrupt")
	await expect(interruptButton(page)).toBeDisabled()
	await replyBox(page).fill("Carry on")
	await expect(send(page)).toBeEnabled()
	expect(posts(backend, "/interrupt")).toHaveLength(1)
})

for (const failure of ["refusal", "rejection", "timeout"] as const) {
	test(`an interrupt ${failure} is reported, never repeated, and offered again`, async ({ desktop: { page }, backend }) => {
		prepareRun(backend)
		backend.handlers.set("POST /run/run-one/interrupt", response => {
			if (failure === "refusal") json(response, { ok: false })
			else if (failure === "rejection") json(response, { detail: "Run is not interruptible" }, 409)
		})
		await page.clock.install()
		await start(page, backend)
		await interruptButton(page).click()
		if (failure === "timeout") await page.clock.fastForward(10_001)
		await expect(alert(page, "Interrupt failed")).toContainText("Interrupt failed: Could not interrupt this run.")
		await expect(interruptButton(page)).toBeEnabled()
		await page.clock.fastForward(30_000)
		expect(posts(backend, "/interrupt")).toHaveLength(1)
	})
}

test("HUD Cancel and the row share one cancellation, then the cancelled run returns to the overview", async ({ desktop: { page }, backend }) => {
	prepareRun(backend)
	let rows = [project("existing-project", { status: "awaiting_user_input", run_id: "run-one" })]
	backend.handlers.set("GET /projects", response => json(response, rows))
	let current = snapshot({ status: "awaiting_user_input", current_prompt_id: "p1", current_prompt: "Question" })
	backend.handlers.set("GET /run/run-one", response => json(response, current))
	let pending: ServerResponse | undefined
	backend.handlers.set("POST /projects/existing-project/cancel", response => { pending = response })
	await page.clock.install()
	await backend.open()
	await page.getByRole("button", { name: "Open existing-project", exact: true }).click()
	await expect(runStatus(page)).toContainText("Awaiting input")
	await replyBox(page).fill("Unsent draft")
	await cancelButton(page).click()
	await expect(cancelButton(page)).toHaveText("Cancelling...")
	await expect(send(page)).toBeDisabled()
	await view(page, "Runs Overview")
	await expect(row(page, "existing-project")).toContainText("CANCELLING")
	await expect(row(page, "existing-project").getByRole("button", { name: "Cancel", exact: true })).toBeDisabled()
	await page.getByRole("button", { name: "Return to existing-project", exact: true }).click()
	json(pending!, { ok: true })
	current = snapshot({ status: "cancelled" })
	rows = [project("existing-project")]
	await page.clock.fastForward(2001)
	await expectOverview(page)
	await expect(row(page, "existing-project")).toContainText("DORMANT")
	expect(posts(backend, "/cancel")).toHaveLength(1)
})

test("a failed HUD cancellation is reported and Cancel is offered again", async ({ desktop: { page }, backend }) => {
	prepareRun(backend)
	backend.handlers.set("POST /projects/existing-project/cancel", response => json(response, { ok: false }))
	await start(page, backend)
	await cancelButton(page).click()
	await expect(alert(page, "Cancellation failed")).toHaveText('Cancellation failed: Could not cancel "existing-project". The project is still active. Try again.')
	await expect(cancelButton(page)).toHaveText("Cancel")
	await expect(cancelButton(page)).toBeEnabled()
	await expect(runStatus(page)).toContainText("Running")
	expect(posts(backend, "/cancel")).toHaveLength(1)
})

test("a run that completes returns to the overview, keeping the unsent draft for the next run", async ({ desktop: { page }, backend }) => {
	prepareRun(backend)
	let current = snapshot()
	backend.handlers.set("GET /run/run-one", response => json(response, current))
	await page.clock.install()
	await start(page, backend)
	await replyBox(page).fill("Keep me")
	current = snapshot({ status: "completed" })
	await page.clock.fastForward(2001)
	await expectOverview(page)
	prepareRun(backend, "run-two")
	await page.locator(".agent-hud__project-row", { hasText: "existing-project" }).getByRole("button", { name: "Launch", exact: true }).click()
	await expect(replyBox(page)).toHaveValue("Keep me")
})
