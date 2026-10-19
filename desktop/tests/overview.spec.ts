import { expect, type Page } from "@playwright/test"
import type { ServerResponse } from "node:http"
import { writeFile } from "node:fs/promises"
import { test, json, project, prepareRun, launchButton, runStatus, view, snapshot } from "./run-fixture"
import type { Backend } from "./selection-fixture"
import { captureNative, setNativeViewport } from "./native"

const catalog = [
	{ name: "base_tool", kind: "tool", selectable: false, loading: null },
	{ name: "web_search", kind: "tool", selectable: true, loading: null },
	{ name: "notes", kind: "skill", selectable: true, loading: "automatic" },
]
const row = (page: Page, slug: string) => page.locator(".agent-hud__project-row", { hasText: slug })
const selector = (page: Page) => page.getByRole("form", { name: "Capability selector" })
const capability = (page: Page, name: string) => selector(page).getByRole("checkbox", { name, exact: true })
const writes = (backend: Backend) => backend.requests.filter(request => request.method !== "GET")
	.map(({ method, path, body }) => ({ method, path, body }))
const listings = (backend: Backend) => backend.requests.filter(request => request.method === "GET" && request.path === "/projects").length

test("the overview shows backend statuses and polls every three seconds only while visible", async ({ desktop: { page }, backend }) => {
	const now = 1_800_000_000
	await page.clock.install({ time: now * 1000 })
	let rows = [
		project("running-project", { status: "running", run_id: "r1", created_at: now - 125 }),
		project("waiting-project", { status: "awaiting_user_input", run_id: "r2" }),
		project("cancelling-project", { status: "cancelling", run_id: "r3" }),
		project("syncing-project", { status: "syncing" }),
		project("dormant-project"),
	]
	backend.handlers.set("GET /projects", response => json(response, rows))
	await backend.open()
	for (const [slug, label] of [["running", "RUNNING"], ["waiting", "WAITING"], ["cancelling", "CANCELLING"], ["syncing", "SYNCING"], ["dormant", "DORMANT"]]) {
		await expect(row(page, `${slug}-project`)).toContainText(label)
	}
	await expect(row(page, "running-project")).toContainText("2m ago")
	await expect(launchButton(page, "running-project")).toBeDisabled()
	await expect(launchButton(page, "dormant-project")).toBeEnabled()
	await expect(row(page, "running-project").getByRole("button", { name: "Cancel", exact: true })).toBeEnabled()
	await expect(row(page, "syncing-project").getByRole("button", { name: "Cancel", exact: true })).toBeEnabled()
	await expect(row(page, "dormant-project").getByRole("button", { name: "Cancel", exact: true })).toBeDisabled()
	await expect(row(page, "running-project").getByRole("button", { name: "Delete", exact: true })).toBeDisabled()
	const before = listings(backend)
	await page.clock.fastForward(3000)
	await expect.poll(() => listings(backend)).toBe(before + 1)
	// A failed read keeps the last rows.
	backend.handlers.set("GET /projects", response => json(response, { detail: "Busy" }, 503))
	await page.clock.fastForward(3000)
	await expect.poll(() => listings(backend)).toBe(before + 2)
	await expect(row(page, "dormant-project")).toBeVisible()
	await view(page, "Environment")
	const hidden = listings(backend)
	await page.clock.fastForward(10_000)
	expect(listings(backend)).toBe(hidden)
	rows = [project("dormant-project")]
	backend.handlers.set("GET /projects", response => json(response, rows))
	await view(page, "Runs Overview")
	await expect(page.getByText("Refreshing project status")).toHaveCount(0)
	await expect(row(page, "running-project")).toHaveCount(0)
	expect(listings(backend)).toBe(hidden + 1)
})

test("New Project creates once, saves the chosen capabilities, then launches and opens the run", async ({ desktop: { page }, backend }) => {
	let created: ServerResponse | undefined
	backend.handlers.set("GET /capabilities", response => json(response, catalog))
	backend.handlers.set("POST /projects", (response, body) => { expect(body).toEqual({ name: "Fresh work" }); created = response })
	prepareRun(backend, "run-fresh", "fresh-work")
	await backend.open()
	await page.getByRole("button", { name: "New Project", exact: true }).click()
	await expect(selector(page).getByRole("heading", { name: "New Project" })).toBeVisible()
	// The submit button is renamed "Launching…" while the launch is pending.
	const launch = selector(page).locator('button[type="submit"]')
	await expect(launch).toHaveAccessibleName("Launch")
	await expect(capability(page, "base tool")).toBeDisabled()
	await expect(capability(page, "base tool")).toHaveAttribute("aria-checked", "true")
	await expect(launch).toBeDisabled()
	await page.getByRole("textbox", { name: "Project name" }).fill("Fresh work")
	await capability(page, "web search").click()
	await capability(page, "notes").click()
	await expect(capability(page, "web search")).toHaveAttribute("aria-checked", "true")
	await launch.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click() })
	await expect.poll(() => created).toBeDefined()
	await expect(launch).toBeDisabled()
	await expect(launch).toHaveAccessibleName("Launching…")
	json(created!, { slug: "fresh-work" })
	await expect(runStatus(page)).toContainText("fresh-work")
	const selection = { web_search: true, notes: "automatic" }
	expect(writes(backend)).toEqual([
		{ method: "POST", path: "/projects", body: { name: "Fresh work" } },
		{ method: "POST", path: "/capabilities/fresh-work", body: selection },
		{ method: "POST", path: "/run/create", body: { project: "fresh-work", capabilities: selection } },
	])
})

test("a failed launch keeps the selector draft and launching again reuses the created project", async ({ desktop: { page }, backend }) => {
	backend.handlers.set("GET /capabilities", response => json(response, catalog))
	backend.handlers.set("POST /projects", response => json(response, { slug: "fresh-work" }))
	backend.handlers.set("POST /run/create", response => json(response, { detail: "Runner unavailable" }, 503))
	await backend.open()
	await page.getByRole("button", { name: "New Project", exact: true }).click()
	await page.getByRole("textbox", { name: "Project name" }).fill("Fresh work")
	await capability(page, "web search").click()
	await selector(page).getByRole("button", { name: "Launch", exact: true }).click()
	await expect(page.getByRole("alert")).toContainText("Launch failed: API request failed (503): Runner unavailable")
	await expect(selector(page).getByRole("heading", { name: "Project: fresh-work" })).toBeVisible()
	await expect(capability(page, "web search")).toHaveAttribute("aria-checked", "true")
	prepareRun(backend, "run-fresh", "fresh-work")
	await selector(page).getByRole("button", { name: "Launch", exact: true }).click()
	await expect(runStatus(page)).toContainText("fresh-work")
	expect(writes(backend).filter(write => write.path === "/projects")).toHaveLength(1)
	expect(writes(backend).filter(write => write.path === "/run/create")).toHaveLength(2)
})

test("Tools restores saved choices, and Escape or Cancel returns to the overview", async ({ desktop: { page }, backend }) => {
	backend.handlers.set("GET /capabilities", response => json(response, catalog))
	backend.handlers.set("GET /capabilities/existing-project", response => json(response, { web_search: true }))
	await backend.open()
	await row(page, "existing-project").getByRole("button", { name: "Tools", exact: true }).click()
	await expect(selector(page).getByRole("heading", { name: "Project: existing-project" })).toBeFocused()
	await expect(capability(page, "web search")).toHaveAttribute("aria-checked", "true")
	await expect(capability(page, "notes")).toHaveAttribute("aria-checked", "false")
	await expect(page.getByRole("textbox", { name: "Project name" })).toHaveCount(0)
	await page.keyboard.press("Escape")
	await expect(selector(page)).toHaveCount(0)
	await page.getByRole("button", { name: "Open existing-project", exact: true }).click()
	await expect(selector(page).getByRole("heading", { name: "Project: existing-project" })).toBeVisible()
	await selector(page).getByRole("button", { name: "Cancel", exact: true }).click()
	await expect(page.getByRole("button", { name: "New Project", exact: true })).toBeVisible()
	expect(writes(backend)).toEqual([])
})

test("capability load failures show inline and recover through Retry", async ({ desktop: { page }, backend }) => {
	backend.handlers.set("GET /capabilities", response => json(response, { detail: "Catalogue unavailable" }, 503))
	await backend.open()
	await page.getByRole("button", { name: "New Project", exact: true }).click()
	await page.getByRole("textbox", { name: "Project name" }).fill("Later")
	await expect(selector(page).getByRole("alert")).toContainText("Catalogue unavailable")
	await expect(selector(page).getByRole("button", { name: "Launch", exact: true })).toBeDisabled()
	backend.handlers.set("GET /capabilities", response => json(response, catalog))
	await selector(page).getByRole("button", { name: "Retry", exact: true }).click()
	await expect(capability(page, "web search")).toBeVisible()
	await expect(selector(page).getByRole("button", { name: "Launch", exact: true })).toBeEnabled()
})

test("rows open active runs and return to the current run", async ({ desktop: { page }, backend }) => {
	backend.handlers.set("GET /projects", response => json(response, [
		project("live-project", { status: "awaiting_user_input", run_id: "run-live" }), project("existing-project"),
	]))
	const live = prepareRun(backend, "run-live", "live-project")
	await backend.open()
	await page.getByRole("button", { name: "Open live-project", exact: true }).click()
	await expect(runStatus(page)).toContainText("live-project")
	await expect.poll(() => live.streams.length).toBe(1)
	await view(page, "Runs Overview")
	await page.getByRole("button", { name: "Return to live-project", exact: true }).click()
	await expect(runStatus(page)).toContainText("live-project")
	expect(live.streams).toHaveLength(1)
	expect(writes(backend)).toEqual([])
})

test("cancel and delete settle through listings and report refused or failed writes", async ({ desktop: { page }, backend }) => {
	let rows = [project("busy", { status: "running", run_id: "run-busy" }), project("old")]
	backend.handlers.set("GET /projects", response => json(response, rows))
	backend.handlers.set("POST /projects/busy/cancel", response => json(response, { ok: false }))
	await backend.open()
	const cancel = row(page, "busy").getByRole("button", { name: "Cancel", exact: true })
	await cancel.click()
	const alert = (title: string) => page.getByRole("alert").filter({ hasText: title })
	await expect(alert("Cancellation failed")).toHaveText('Cancellation failed: Could not cancel "busy". The project is still active. Try again.')
	await expect(row(page, "busy")).toContainText("RUNNING")
	backend.handlers.set("POST /projects/busy/cancel", response => json(response, { ok: true }))
	await cancel.click()
	await expect(row(page, "busy")).toContainText("CANCELLING")
	rows = [project("busy"), project("old")]
	await expect(row(page, "busy")).toContainText("DORMANT")
	backend.handlers.set("DELETE /projects/old", response => json(response, { detail: "Project is busy" }, 409))
	await row(page, "old").getByRole("button", { name: "Delete", exact: true }).click()
	await row(page, "old").getByRole("button", { name: "Confirm?", exact: true }).click()
	await expect(alert("Deletion failed")).toHaveText('Deletion failed: Could not delete "old". The project was not deleted. Try again.')
	await expect(row(page, "old")).toContainText("DORMANT")
	backend.handlers.set("DELETE /projects/old", response => json(response, { ok: true }))
	await row(page, "old").getByRole("button", { name: "Delete", exact: true }).click()
	await row(page, "old").getByRole("button", { name: "Confirm?", exact: true }).click()
	rows = [project("busy")]
	await expect(row(page, "old")).toHaveCount(0)
	expect(writes(backend).map(write => `${write.method} ${write.path}`)).toEqual([
		"POST /projects/busy/cancel", "POST /projects/busy/cancel", "DELETE /projects/old", "DELETE /projects/old",
	])
})

test("a cancellation keeps its row locked until the request settles, even if a listing reports dormant", async ({ desktop: { page }, backend }) => {
	let rows = [project("existing-project", { status: "running", run_id: "old-run" })]
	let cancellation: ServerResponse | undefined
	backend.handlers.set("GET /projects", response => json(response, rows))
	backend.handlers.set("POST /projects/existing-project/cancel", response => { cancellation = response })
	await backend.open()
	await page.clock.install()
	await row(page, "existing-project").getByRole("button", { name: "Cancel", exact: true }).click()
	await expect.poll(() => cancellation).toBeDefined()
	rows = [project("existing-project")]
	const before = listings(backend)
	await page.clock.fastForward(1000)
	await expect.poll(() => listings(backend)).toBeGreaterThan(before)
	await expect(row(page, "existing-project")).toContainText("CANCELLING")
	await expect(launchButton(page, "existing-project")).toBeDisabled()
	json(cancellation!, { ok: true })
	await expect(row(page, "existing-project")).toContainText("DORMANT")
	await expect(launchButton(page, "existing-project")).toBeEnabled()
})

test("reopening Tools waits for fresh choices instead of offering the previous ones", async ({ desktop: { page }, backend }) => {
	let saved: unknown = null
	backend.handlers.set("GET /capabilities", response => json(response, catalog))
	backend.handlers.set("GET /capabilities/existing-project", response => json(response, saved))
	backend.handlers.set("POST /capabilities/existing-project", (response, body) => { saved = body; json(response, body) })
	prepareRun(backend)
	backend.handlers.set("GET /run/run-one", response => json(response, snapshot({ status: "completed" })))
	await backend.open()
	await row(page, "existing-project").getByRole("button", { name: "Tools", exact: true }).click()
	await capability(page, "web search").click()
	await selector(page).getByRole("button", { name: "Launch", exact: true }).click()
	await expect(runStatus(page)).toContainText("Completed")
	expect(saved).toEqual({ web_search: true })
	await view(page, "Runs Overview")
	let refreshing: ServerResponse | undefined
	backend.handlers.set("GET /capabilities/existing-project", response => { refreshing = response })
	await row(page, "existing-project").getByRole("button", { name: "Tools", exact: true }).click()
	await expect.poll(() => refreshing).toBeDefined()
	await expect(selector(page).getByRole("status")).toHaveText("Loading capabilities…")
	await expect(selector(page).locator('button[type="submit"]')).toBeDisabled()
	json(refreshing!, saved)
	await expect(capability(page, "web search")).toHaveAttribute("aria-checked", "true")
	expect(writes(backend).filter(write => write.path === "/capabilities/existing-project")).toHaveLength(1)
})

test("a failed first listing reports the error with Retry instead of an empty hub", async ({ desktop: { page }, backend }) => {
	backend.handlers.set("GET /projects", response => json(response, { detail: "Storage unreadable" }, 500))
	await backend.open({ awaitOverview: false })
	await expect(page.getByRole("alert")).toContainText("Could not load projects: API request failed (500): Storage unreadable")
	await expect(page.getByText("No projects", { exact: true })).toHaveCount(0)
	backend.handlers.set("GET /projects", response => json(response, [project("existing-project")]))
	await page.getByRole("alert").getByRole("button", { name: "Retry", exact: true }).click()
	await expect(page.getByRole("button", { name: "Open existing-project", exact: true })).toBeVisible()
	await expect(page.getByRole("alert")).toHaveCount(0)
})

for (const theme of ["dark", "light"]) {
	test(`long project names fit narrow zoomed windows in ${theme}`, async ({ desktop: { app, page }, backend }, testInfo) => {
		const longName = "project-" + "long-name-".repeat(20)
		backend.handlers.set("GET /projects", response => json(response, [project(longName), project("short")]))
		await backend.open()
		if (theme === "light") await page.getByRole("button", { name: "Toggle color theme" }).click()
		for (const [width, height, zoom] of [[1260, 780, 1], [640, 420, 1], [640, 420, 1.25]]) {
			await setNativeViewport(app, page, width, height, zoom)
			await expect(page.getByRole("button", { name: `Open ${longName}`, exact: true })).toBeVisible()
			expect(await page.evaluate(() => document.documentElement.scrollHeight === innerHeight
				&& document.documentElement.scrollWidth === innerWidth)).toBe(true)
			const screenshot = testInfo.outputPath(`overview-${theme}-${width}-${zoom}.png`)
			await writeFile(screenshot, (await captureNative(app, page, width, height))!)
			await testInfo.attach(`overview-${theme}-${width}-${zoom}.png`, { path: screenshot, contentType: "image/png" })
		}
	})
}
