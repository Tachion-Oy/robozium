import { expect, type Locator, type Page } from "@playwright/test"
import type { ServerResponse } from "node:http"
import { test, json, project, prepareRun, snapshot, start, view, replyBox, runStatus, expectOverview } from "./run-fixture"
import type { Backend } from "./selection-fixture"
import { setNativeViewport } from "./native"
import { expectFooterGeometry } from "./footer-geometry"

const interruptButton = (page: Page) => page.locator(".agent-hud__interrupt")
const cancelButton = (page: Page) => page.locator(".agent-hud__cancel")
const send = (page: Page) => page.locator(".agent-hud__send")
const posts = (backend: Backend, suffix: string) => backend.requests.filter(request => request.method === "POST" && request.path.endsWith(suffix))
const alert = (page: Page, title: string) => page.getByRole("alert").filter({ hasText: title })
/** A pending action keeps its label, so its width and the footer layout stay put. */
async function expectBusy(button: Locator, label: string) {
	await expect(button).toHaveAttribute("aria-busy", "true")
	await expect(button).toHaveText(label)
}
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
	await expectBusy(interruptButton(page), "Interrupt")
	await expect(interruptButton(page)).toBeDisabled()
	await expect(send(page)).toBeDisabled()
	json(pending!, { ok: true })
	// An accepted interruption stays pending while snapshots still show the agent working.
	await page.clock.fastForward(2001)
	await expectBusy(interruptButton(page), "Interrupt")
	current = snapshot({ status: "awaiting_user_input", current_prompt_id: "p1", current_prompt: "Interrupted. What next?" })
	await page.clock.fastForward(2001)
	await expect(interruptButton(page)).not.toHaveAttribute("aria-busy")
	await expect(interruptButton(page)).toBeDisabled()
	await replyBox(page).fill("Carry on")
	await expect(send(page)).toBeEnabled()
	expect(posts(backend, "/interrupt")).toHaveLength(1)
})

test("an accepted reply offers Interrupt at once, though snapshots still show the answered prompt", async ({ desktop: { page }, backend }) => {
	prepareRun(backend)
	let current = snapshot({ status: "awaiting_user_input", current_prompt_id: "p1", current_prompt: "Continue?" })
	backend.handlers.set("GET /run/run-one", response => json(response, current))
	backend.handlers.set("POST /run/run-one/reply", response => json(response, { ok: true }))
	await page.clock.install()
	await start(page, backend)
	await expect(interruptButton(page)).toBeDisabled()
	await replyBox(page).fill("Go on")
	await send(page).click()
	await expect(replyBox(page)).toHaveValue("")
	await expect(interruptButton(page)).toBeEnabled({ timeout: 1000 })
	// A snapshot from before the reply cannot take the working state back.
	await page.clock.fastForward(2001)
	await expect(interruptButton(page)).toBeEnabled()
	current = snapshot({ status: "awaiting_user_input", current_prompt_id: "p2", current_prompt: "Next?" })
	await page.clock.fastForward(2001)
	await expect(interruptButton(page)).toBeDisabled()
})

test("footer actions sit all beside the arrows or all below them, and a press never moves them", async ({ desktop: { app, page }, backend }) => {
	prepareRun(backend)
	backend.handlers.set("GET /run/run-one", response => json(response, snapshot()))
	backend.handlers.set("POST /run/run-one/interrupt", () => {})
	await start(page, backend)
	await expect(interruptButton(page)).toBeEnabled()
	// The actions join the first row near 1180 px at 125%; sample where their labels differ.
	const widths = Array.from({ length: 21 }, (_, step) => 1080 + step * 10)
	const placements = async () => {
		const result: Record<number, string[]> = {}
		for (const width of widths) {
			await setNativeViewport(app, page, width, 420, 1.25)
			await expectFooterGeometry(page)
			// Placement updates on an animation frame after a resize.
			await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
			result[width] = await page.locator(".agent-hud__actions [data-hud-action-placement]").evaluateAll(actions =>
				actions.map(action => `${action.className.split(" ")[0]}:${action.getAttribute("data-hud-action-placement")}`))
		}
		return result
	}
	// Too narrow even for one row below: labels truncate instead of wrapping.
	// The window stops at 640 px, so a higher zoom stands in for a narrower window.
	// Each step keeps whole CSS pixels at both the previous and the new zoom.
	for (const zoom of [1.6, 1.25]) {
		await setNativeViewport(app, page, 640, 480, zoom)
		await expectFooterGeometry(page)
		const row = await page.locator(".agent-hud__actions").evaluate(root => {
			const actions = [...root.querySelectorAll<HTMLElement>("[data-hud-action-placement]")]
			const labels = [...root.querySelectorAll<HTMLElement>("button > span")]
			return {
				below: actions.every(action => action.dataset.hudActionPlacement === "overflow"),
				oneRow: new Set(actions.map(action => Math.round(action.getBoundingClientRect().top))).size === 1,
				truncated: labels.some(label => label.scrollWidth > label.clientWidth && getComputedStyle(label).textOverflow === "ellipsis"),
			}
		})
		expect(row).toEqual({ below: true, oneRow: true, truncated: true })
	}
	const resting = await placements()
	for (const actions of Object.values(resting)) expect(new Set(actions.map(action => action.split(":")[1])).size).toBe(1)
	expect(new Set(Object.values(resting).map(actions => actions[0].split(":")[1]))).toEqual(new Set(["primary", "overflow"]))
	await interruptButton(page).click()
	await expectBusy(interruptButton(page), "Interrupt")
	expect(await placements()).toEqual(resting)
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
		await expect(alert(page, "Interrupt failed")).toContainText("Could not interrupt this run.")
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
	await expectBusy(cancelButton(page), "Cancel")
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
	await expect(alert(page, "Cancellation failed").locator("p")).toHaveText(["Cancellation failed", 'Could not cancel "existing-project".', "The project is still active. Try again."])
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
