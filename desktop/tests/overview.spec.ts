import { expect, type Locator, type Page } from "@playwright/test"
import type { ServerResponse } from "node:http"
import { writeFile } from "node:fs/promises"
import { test, json, project, prepareRun, launchButton, runStatus, view, snapshot, expectOverview, replyBox } from "./run-fixture"
import type { Backend } from "./selection-fixture"
import { captureNative, inlineAlerts, setNativeViewport, toast, viewTrigger } from "./native"

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
const waiting = (slug: string, runId: string) => project(slug, { status: "awaiting_user_input", run_id: runId })
const viewMenu = (page: Page) => page.getByRole("listbox", { name: "HUD view" })
const runsEntry = (page: Page) => viewMenu(page).getByRole("option", { name: "2 Runs", exact: true })
const runsPanel = (page: Page) => page.getByRole("listbox", { name: "2 Runs", exact: true })
const listings = (backend: Backend) => backend.requests.filter(request => request.method === "GET" && request.path === "/projects").length

test("the overview shows backend statuses, and the listing polls every three seconds on every screen", async ({ desktop: { page }, backend }) => {
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
		const status = row(page, `${slug}-project`).getByText(label, { exact: true })
		await expect(status).toBeVisible()
		// Only the resting state is regular weight, so active states stand out in either theme.
		await expect(status).toHaveCSS("font-weight", slug === "dormant" ? "400" : "700")
	}
	// Dark marks a live project with a lit lamp and one at rest with a hollow one.
	await expect(row(page, "running-project").locator(".agent-hud__row-status")).toHaveAttribute("data-live")
	await expect(row(page, "dormant-project").locator(".agent-hud__row-status")).not.toHaveAttribute("data-live")
	// A hovered row's text takes no filter: one is redrawn off screen with its glow on every hover.
	await row(page, "running-project").hover()
	await expect(row(page, "running-project").locator(".agent-hud__project-summary")).toHaveCSS("filter", "none")
	await expect(row(page, "running-project")).toContainText("2m ago")
	// A live run opens, a dormant project launches; Launch or Open comes first.
	await expect(row(page, "running-project").getByRole("button")).toHaveText(["Open", "Edit", "Cancel", "Delete"])
	await expect(launchButton(page, "running-project")).toHaveCount(0)
	await expect(row(page, "dormant-project").getByRole("button")).toHaveText(["Launch", "Edit", "Cancel", "Delete"])
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
	// The view menu names the runs on every screen, so the listing is read off the overview too.
	await view(page, "Environment")
	await expect.poll(() => listings(backend)).toBe(before + 3)
	await page.clock.fastForward(3000)
	await expect.poll(() => listings(backend)).toBe(before + 4)
	// Opening the overview reads at once.
	rows = [project("dormant-project")]
	backend.handlers.set("GET /projects", response => json(response, rows))
	await view(page, "Runs Overview")
	await expect(page.getByText("Refreshing project status")).toHaveCount(0)
	await expect(row(page, "running-project")).toHaveCount(0)
	expect(listings(backend)).toBe(before + 5)
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
	// Each capability is badged with its kind.
	await expect(capability(page, "base tool").locator(".agent-hud__capability-badge")).toHaveText("Tool")
	await expect(capability(page, "notes").locator(".agent-hud__capability-badge")).toHaveText("Skill")
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
	await expect(page.getByRole("alert").locator("p")).toHaveText(["Launch failed", "API request failed (503): Runner unavailable"])
	await expect(selector(page).getByRole("heading", { name: "Project: fresh-work" })).toBeVisible()
	await expect(capability(page, "web search")).toHaveAttribute("aria-checked", "true")
	prepareRun(backend, "run-fresh", "fresh-work")
	await selector(page).getByRole("button", { name: "Launch", exact: true }).click()
	await expect(runStatus(page)).toContainText("fresh-work")
	expect(writes(backend).filter(write => write.path === "/projects")).toHaveLength(1)
	expect(writes(backend).filter(write => write.path === "/run/create")).toHaveLength(2)
})

test("Edit restores saved choices, and Escape or Cancel returns to the overview", async ({ desktop: { page }, backend }) => {
	backend.handlers.set("GET /capabilities", response => json(response, catalog))
	backend.handlers.set("GET /capabilities/existing-project", response => json(response, { web_search: true }))
	await backend.open()
	await row(page, "existing-project").getByRole("button", { name: "Edit", exact: true }).click()
	await expect(selector(page).getByRole("heading", { name: "Project: existing-project" })).toBeFocused()
	await expect(capability(page, "web search")).toHaveAttribute("aria-checked", "true")
	await expect(capability(page, "notes")).toHaveAttribute("aria-checked", "false")
	// An existing project's name shows in a read-only field until Rename.
	await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue("existing-project")
	await expect(page.getByRole("textbox", { name: "Project name" })).not.toBeEditable()
	await page.keyboard.press("Escape")
	await expect(selector(page)).toHaveCount(0)
	// The row itself is not a button: clicking it does nothing.
	await row(page, "existing-project").getByText("existing-project").click()
	await expect(selector(page)).toHaveCount(0)
	// Hovering the row, its buttons included, only tints it; the arrow cursor says it is not clickable.
	const background = () => row(page, "existing-project").evaluate(element => getComputedStyle(element).backgroundColor)
	await page.mouse.move(0, 0)
	const resting = await background()
	await row(page, "existing-project").getByRole("button", { name: "Edit", exact: true }).hover()
	await expect.poll(background).not.toBe(resting)
	await row(page, "existing-project").getByText("existing-project").hover()
	await expect(row(page, "existing-project").getByText("existing-project")).toHaveCSS("cursor", "default")
	await expect(page.getByRole("button", { name: "New Project", exact: true })).toBeVisible()
	expect(writes(backend)).toEqual([])
})

test("capability load failures show in a toast and recover through Retry", async ({ desktop: { page }, backend }) => {
	backend.handlers.set("GET /capabilities", response => json(response, { detail: "Catalogue unavailable" }, 503))
	await backend.open()
	await page.getByRole("button", { name: "New Project", exact: true }).click()
	await page.getByRole("textbox", { name: "Project name" }).fill("Later")
	const failure = toast(page, "Could not load capabilities")
	await expect(failure).toContainText("Catalogue unavailable")
	await expect(inlineAlerts(page)).toHaveCount(0)
	await expect(selector(page).getByRole("button", { name: "Launch", exact: true })).toBeDisabled()
	backend.handlers.set("GET /capabilities", response => json(response, catalog))
	await failure.getByRole("button", { name: "Retry", exact: true }).click()
	await expect(failure).toHaveCount(0)
	await expect(capability(page, "web search")).toBeVisible()
	await expect(selector(page).getByRole("button", { name: "Launch", exact: true })).toBeEnabled()
})

test("Open opens active runs and returns to the current run", async ({ desktop: { page }, backend }) => {
	backend.handlers.set("GET /projects", response => json(response, [
		project("live-project", { status: "awaiting_user_input", run_id: "run-live" }), project("existing-project"),
	]))
	const live = prepareRun(backend, "run-live", "live-project")
	await backend.open()
	await page.getByRole("button", { name: "Open live-project", exact: true }).click()
	await expect(runStatus(page)).toContainText("live-project")
	await expect.poll(() => live.streams.length).toBe(1)
	await view(page, "Runs Overview")
	await page.getByRole("button", { name: "Open live-project", exact: true }).click()
	await expect(runStatus(page)).toContainText("live-project")
	expect(live.streams).toHaveLength(1)
	expect(writes(backend)).toEqual([])
})

test("the view menu names a single run and opens it; several are counted and listed beside the menu", async ({ desktop: { page }, backend }) => {
	let rows = [waiting("live-project", "run-live"), project("other-project")]
	backend.handlers.set("GET /projects", response => json(response, rows))
	prepareRun(backend, "run-live", "live-project")
	prepareRun(backend, "run-other", "other-project")
	await backend.open()
	// One run: the entry is its name, and opens a run the HUD has not opened yet.
	await view(page, "live-project")
	await expect(runStatus(page)).toContainText("live-project")
	await expect(viewTrigger(page)).toHaveAccessibleName("live-project")
	// Two runs: the entry counts them, and its panel lists them with the one on screen marked.
	rows = [waiting("live-project", "run-live"), waiting("other-project", "run-other")]
	await expect(viewTrigger(page)).toHaveAccessibleName("2 Runs")
	await viewTrigger(page).click()
	await expect(runsEntry(page)).toHaveAttribute("aria-expanded", "false")
	await runsEntry(page).click()
	await expect(runsPanel(page).getByRole("option")).toHaveCount(2)
	await expect(runsPanel(page).getByRole("option", { name: "live-project", exact: true })).toHaveAttribute("aria-selected", "true")
	await runsPanel(page).getByRole("option", { name: "other-project", exact: true }).click()
	await expect(page.getByRole("listbox")).toHaveCount(0)
	await expect(runStatus(page)).toContainText("other-project")
	expect(writes(backend)).toEqual([])
})

test("the open view menu keeps its runs while one ends, and the ended run's entry leads to the overview", async ({ desktop: { page }, backend }) => {
	let rows = [waiting("live-project", "run-live"), waiting("other-project", "run-other")]
	backend.handlers.set("GET /projects", response => json(response, rows))
	prepareRun(backend, "run-live", "live-project")
	prepareRun(backend, "run-other", "other-project")
	backend.handlers.set("GET /run/run-other", response => json(response, snapshot({ project: "other-project", status: "completed" })))
	await backend.open()
	await viewTrigger(page).click()
	await runsEntry(page).click()
	await expect(runsPanel(page).getByRole("option")).toHaveCount(2)
	// The overview behind the menu shows the listing that reports the run ended.
	rows = [waiting("live-project", "run-live"), project("other-project")]
	await expect(row(page, "other-project").getByText("DORMANT", { exact: true })).toBeVisible()
	await expect(runsEntry(page)).toBeVisible()
	await expect(runsPanel(page).getByRole("option")).toHaveCount(2)
	await runsPanel(page).getByRole("option", { name: "other-project", exact: true }).click()
	await expectOverview(page)
	// The next opening shows the one run left.
	await viewTrigger(page).click()
	await expect(viewMenu(page).getByRole("option", { name: "live-project", exact: true })).toBeVisible()
	await expect(runsEntry(page)).toHaveCount(0)
})

test("the view menu's runs panel opens and closes from the keyboard", async ({ desktop: { page }, backend }) => {
	backend.handlers.set("GET /projects", response => json(response, [waiting("live-project", "run-live"), waiting("other-project", "run-other")]))
	await backend.open()
	await viewTrigger(page).click()
	await page.keyboard.press("ArrowUp")
	await expect(runsEntry(page)).toBeFocused()
	await page.keyboard.press("ArrowRight")
	await expect(runsPanel(page).getByRole("option", { name: "live-project", exact: true })).toBeFocused()
	await page.keyboard.press("ArrowDown")
	await expect(runsPanel(page).getByRole("option", { name: "other-project", exact: true })).toBeFocused()
	await page.keyboard.press("ArrowLeft")
	await expect(runsPanel(page)).toHaveCount(0)
	await expect(runsEntry(page)).toBeFocused()
	await page.keyboard.press("Enter")
	await expect(runsPanel(page)).toBeVisible()
	// Escape leaves the panel first, then the menu.
	await page.keyboard.press("Escape")
	await expect(runsPanel(page)).toHaveCount(0)
	await expect(runsEntry(page)).toBeFocused()
	await page.keyboard.press("Escape")
	await expect(viewMenu(page)).toHaveCount(0)
	await expect(viewTrigger(page)).toBeFocused()
})

for (const theme of ["dark", "light"]) {
	test(`a long run name never widens the view button or menu, and the runs panel fits a narrow zoomed window in ${theme}`, async ({ desktop: { app, page }, backend }, testInfo) => {
		const longName = "a-project-with-a-very-long-name"
		let rows = [project(longName), project(`${longName}-two`)]
		backend.handlers.set("GET /projects", response => json(response, rows))
		prepareRun(backend, "run-long", longName)
		await backend.open()
		if (theme === "light") await page.getByRole("button", { name: "Toggle color theme" }).click()
		const width = (target: Locator) => target.evaluate(element => element.getBoundingClientRect().width)
		const cut = (label: Locator) => label.evaluate(element => element.scrollWidth > element.clientWidth)
		// Without a run the button reads Runs Overview, the longest view, in full.
		await viewTrigger(page).click()
		const plainTrigger = await width(viewTrigger(page))
		const plainMenu = await width(viewMenu(page))
		expect(await cut(viewTrigger(page).locator("span"))).toBe(false)
		expect(await cut(viewMenu(page).getByRole("option", { name: "Runs Overview", exact: true }).locator(".agent-hud__model-option-label"))).toBe(false)
		await page.keyboard.press("Escape")
		rows = [waiting(longName, "run-long"), project(`${longName}-two`)]
		await expect(row(page, longName).first().getByText("WAITING", { exact: true })).toBeVisible()
		await viewTrigger(page).click()
		const entry = viewMenu(page).getByRole("option", { name: longName, exact: true })
		expect(await width(viewMenu(page))).toBeCloseTo(plainMenu, 0)
		expect(await cut(entry.locator(".agent-hud__model-option-label"))).toBe(true)
		await entry.click()
		await expect(runStatus(page)).toContainText(longName)
		expect(await width(viewTrigger(page))).toBeLessThanOrEqual(plainTrigger + 1)
		rows = [waiting(longName, "run-long"), waiting(`${longName}-two`, "run-two")]
		await expect(viewTrigger(page)).toHaveAccessibleName("2 Runs")
		// setNativeViewport needs a size its zoom divides exactly, which 1.4 never does near the
		// minimum width. 642 at 1.5 is a narrower page than the minimum 640 at 1.4.
		for (const [width, zoom] of [[640, 1], [642, 1.5]]) {
			await setNativeViewport(app, page, width, 420, zoom)
			await viewTrigger(page).click()
			await runsEntry(page).click()
			await expect(runsPanel(page).getByRole("option")).toHaveCount(2)
			// The panel sits left of the menu, and both stay inside the window.
			expect(await page.evaluate(() => {
				const [menu, panel] = [...document.querySelectorAll(".agent-hud__model-menu")].map(element => element.getBoundingClientRect())
				return {
					beside: panel.right <= menu.left && Math.abs(panel.top - menu.top) < 1,
					contained: [menu, panel].every(rect => rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight),
					still: document.documentElement.scrollWidth === innerWidth && document.documentElement.scrollHeight === innerHeight,
				}
			})).toEqual({ beside: true, contained: true, still: true })
			const screenshot = testInfo.outputPath(`runs-panel-${theme}-${zoom}.png`)
			await writeFile(screenshot, (await captureNative(app, page, width, 420))!)
			await testInfo.attach(`runs-panel-${theme}-${zoom}.png`, { path: screenshot, contentType: "image/png" })
			await page.keyboard.press("Escape")
			await page.keyboard.press("Escape")
		}
	})
}

for (const theme of ["dark", "light"]) {
	test(`the overview keeps one gap below the selectors before, during and after a run in ${theme}`, async ({ desktop: { page }, backend }) => {
		prepareRun(backend)
		await backend.open()
		if (theme === "light") await page.getByRole("button", { name: "Toggle color theme" }).click()
		await expect(page.locator("html")).toHaveAttribute("data-theme", theme)
		// Layout offsets, since the view scales in as it opens.
		const tableGap = async () => {
			await expect(page.locator(".agent-hud__table-header")).toBeVisible()
			return page.locator(".agent-hud__box").evaluate(box => {
				const header = box.querySelector<HTMLElement>(".agent-hud__header")!
				const view = box.querySelector<HTMLElement>(".agent-hud__project-view")!
				return view.offsetTop - (header.offsetTop + header.offsetHeight)
			})
		}
		const header = page.locator(".agent-hud__header")
		const headerMargin = () => header.evaluate(element => getComputedStyle(element).marginBottom)
		const fresh = await tableGap()
		const freshMargin = await headerMargin()
		await page.locator(".agent-hud__project-row", { hasText: "existing-project" }).getByRole("button", { name: "Edit", exact: true }).click()
		await expect(page.getByRole("form", { name: "Capability selector" })).toBeVisible()
		expect(await headerMargin()).toBe(freshMargin)
		await page.getByRole("button", { name: "Cancel", exact: true }).click()
		await launchButton(page, "existing-project").click()
		await expect(replyBox(page)).toBeFocused()
		await view(page, "Runs Overview")
		expect(await tableGap()).toBe(fresh)
		await page.locator(".agent-hud__project-row", { hasText: "existing-project" }).getByRole("button", { name: "Edit", exact: true }).click()
		await expect(page.getByRole("form", { name: "Capability selector" })).toBeVisible()
		expect(await headerMargin()).toBe(freshMargin)
		await page.getByRole("button", { name: "Cancel", exact: true }).click()
		// The run ends while its HUD is open; the overview it returns to keeps the same gap.
		backend.handlers.set("GET /run/run-one", response => json(response, snapshot({ status: "cancelled" })))
		await view(page, "existing-project")
		await expectOverview(page)
		expect(await tableGap()).toBe(fresh)
	})
}

test("no project name is singled out while several runs are live", async ({ desktop: { page }, backend }) => {
	backend.handlers.set("GET /projects", response => json(response, [
		project("first-project", { status: "awaiting_user_input", run_id: "run-first" }),
		project("second-project", { status: "awaiting_user_input", run_id: "run-second" }),
	]))
	prepareRun(backend, "run-first", "first-project")
	await backend.open()
	await page.getByRole("button", { name: "Open first-project", exact: true }).click()
	await expect(runStatus(page)).toContainText("first-project")
	await view(page, "Runs Overview")
	const names = page.locator(".agent-hud__project-row .agent-hud__project-summary > span > span:nth-child(2)")
	await expect(names).toHaveText(["first-project", "second-project"])
	const looks = await names.evaluateAll(elements => elements.map(element => {
		const style = getComputedStyle(element)
		return { color: style.color, textShadow: style.textShadow, animation: style.animationName }
	}))
	expect(looks[0]).toEqual(looks[1])
	await expect(page.locator(".agent-hud__project-row[aria-current]")).toHaveCount(0)
})

test("cancel and delete settle through listings and report refused or failed writes", async ({ desktop: { page }, backend }) => {
	let rows = [project("busy", { status: "running", run_id: "run-busy" }), project("old")]
	backend.handlers.set("GET /projects", response => json(response, rows))
	backend.handlers.set("POST /projects/busy/cancel", response => json(response, { ok: false }))
	await backend.open()
	const cancel = row(page, "busy").getByRole("button", { name: "Cancel", exact: true })
	await cancel.click()
	const alert = (title: string) => page.getByRole("alert").filter({ hasText: title })
	await expect(alert("Cancel failed").locator("p")).toHaveText(["Cancel failed", 'Could not cancel "busy".', "The project is still active. Try again."])
	await expect(row(page, "busy")).toContainText("RUNNING")
	backend.handlers.set("POST /projects/busy/cancel", response => json(response, { ok: true }))
	await cancel.click()
	await expect(row(page, "busy")).toContainText("CANCELLING")
	rows = [project("busy"), project("old")]
	await expect(row(page, "busy")).toContainText("DORMANT")
	backend.handlers.set("DELETE /projects/old", response => json(response, { detail: "Project is busy" }, 409))
	await row(page, "old").getByRole("button", { name: "Delete", exact: true }).click()
	await row(page, "old").getByRole("button", { name: "Confirm?", exact: true }).click()
	await expect(alert("Deletion failed").locator("p")).toHaveText(["Deletion failed", 'Could not delete "old".', "The project was not deleted. Try again."])
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

test("Rename saves the new name on Enter, keeps the draft, and reports a refusal with the field still editable", async ({ desktop: { page }, backend }) => {
	let rows = [project("existing-project")]
	backend.handlers.set("GET /projects", response => json(response, rows))
	backend.handlers.set("GET /capabilities", response => json(response, catalog))
	backend.handlers.set("GET /capabilities/existing-project", response => json(response, {}))
	backend.handlers.set("GET /capabilities/new-name", response => json(response, {}))
	let refuse = true
	backend.handlers.set("POST /projects/existing-project/rename", response => {
		if (refuse) return json(response, { detail: "A project with this name already exists." }, 409)
		rows = [project("new-name")]
		json(response, { slug: "new-name" })
	})
	await backend.open()
	await row(page, "existing-project").getByRole("button", { name: "Edit", exact: true }).click()
	await capability(page, "web search").click()
	const field = page.getByRole("textbox", { name: "Project name" })
	const launch = selector(page).getByRole("button", { name: "Launch", exact: true })

	// Escape restores the name and locks the field, not the screen, and sends nothing.
	await expect(field).not.toBeEditable()
	await selector(page).getByRole("button", { name: "Rename", exact: true }).click()
	await expect(field).toBeFocused()
	await expect(field).toBeEditable()
	await expect(launch).toBeDisabled()
	await page.keyboard.type("Dropped")
	await page.keyboard.press("Escape")
	await expect(field).toHaveValue("existing-project")
	await expect(field).not.toBeEditable()
	await expect(selector(page).getByRole("heading", { name: "Project: existing-project" })).toBeFocused()
	await expect(launch).toBeEnabled()
	expect(writes(backend)).toEqual([])

	// The opened field has its text selected, so typing replaces the name.
	await selector(page).getByRole("button", { name: "Rename", exact: true }).click()
	await page.keyboard.type("New Name")
	await page.keyboard.press("Enter")
	await expect(toast(page, "Rename failed")).toContainText("A project with this name already exists.")
	await expect(field).toHaveValue("New Name")
	await expect(selector(page).getByRole("heading", { name: "Project: existing-project" })).toBeVisible()

	refuse = false
	await page.keyboard.press("Enter")
	await expect(selector(page).getByRole("heading", { name: "Project: new-name" })).toBeVisible()
	await expect(field).toHaveValue("new-name")
	await expect(field).not.toBeEditable()
	await expect(capability(page, "web search")).toHaveAttribute("aria-checked", "true")
	expect(writes(backend)).toEqual([
		{ method: "POST", path: "/projects/existing-project/rename", body: { name: "New Name" } },
		{ method: "POST", path: "/projects/existing-project/rename", body: { name: "New Name" } },
	])
	// The renamed project's title has the focus, so Escape leaves the screen.
	await page.keyboard.press("Escape")
	await expect(row(page, "new-name")).toBeVisible()
	await expect(row(page, "existing-project")).toHaveCount(0)
})

test("reopening Edit waits for fresh choices instead of offering the previous ones", async ({ desktop: { page }, backend }) => {
	let saved: unknown = null
	backend.handlers.set("GET /capabilities", response => json(response, catalog))
	backend.handlers.set("GET /capabilities/existing-project", response => json(response, saved))
	backend.handlers.set("POST /capabilities/existing-project", (response, body) => { saved = body; json(response, body) })
	prepareRun(backend)
	backend.handlers.set("GET /run/run-one", response => json(response, snapshot({ status: "completed" })))
	await backend.open()
	await row(page, "existing-project").getByRole("button", { name: "Edit", exact: true }).click()
	await capability(page, "web search").click()
	await selector(page).getByRole("button", { name: "Launch", exact: true }).click()
	await expectOverview(page)
	expect(saved).toEqual({ web_search: true })
	let refreshing: ServerResponse | undefined
	backend.handlers.set("GET /capabilities/existing-project", response => { refreshing = response })
	await row(page, "existing-project").getByRole("button", { name: "Edit", exact: true }).click()
	await expect.poll(() => refreshing).toBeDefined()
	await expect(selector(page).getByRole("status")).toHaveText("Loading capabilities…")
	await expect(selector(page).locator('button[type="submit"]')).toBeDisabled()
	json(refreshing!, saved)
	await expect(capability(page, "web search")).toHaveAttribute("aria-checked", "true")
	expect(writes(backend).filter(write => write.path === "/capabilities/existing-project")).toHaveLength(1)
})

test("a failed first listing reports the error in a toast with Retry instead of an empty hub", async ({ desktop: { page }, backend }) => {
	backend.handlers.set("GET /projects", response => json(response, { detail: "Storage unreadable" }, 500))
	await backend.open({ awaitOverview: false })
	const failure = toast(page, "Could not load projects")
	await expect(failure).toContainText("API request failed (500): Storage unreadable")
	await expect(inlineAlerts(page)).toHaveCount(0)
	await expect(page.getByText("No projects", { exact: true })).toHaveCount(0)
	backend.handlers.set("GET /projects", response => json(response, [project("existing-project")]))
	await failure.getByRole("button", { name: "Retry", exact: true }).click()
	await expect(launchButton(page, "existing-project")).toBeVisible()
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
			await expect(launchButton(page, longName)).toBeVisible()
			expect(await page.evaluate(() => document.documentElement.scrollHeight === innerHeight
				&& document.documentElement.scrollWidth === innerWidth)).toBe(true)
			// The table never scrolls sideways: buttons that do not fit beside the summary
			// wrap below it, starting at its left edge.
			expect(await page.locator(".agent-hud__table-scroll").evaluate(scroller => {
				const rows = [...scroller.querySelectorAll(".agent-hud__project-row")].map(row => ({
					summary: row.querySelector(".agent-hud__project-summary")!.getBoundingClientRect(),
					actions: row.querySelector(".agent-hud__row-actions")!.getBoundingClientRect(),
				}))
				const placed = rows.every(({ summary, actions }) => actions.top >= summary.bottom - 1
					? Math.abs(actions.left - summary.left) < 1
					: actions.left >= summary.right - 1)
				return { fits: scroller.scrollWidth <= scroller.clientWidth, placed }
			})).toEqual({ fits: true, placed: true })
			const screenshot = testInfo.outputPath(`overview-${theme}-${width}-${zoom}.png`)
			await writeFile(screenshot, (await captureNative(app, page, width, height))!)
			await testInfo.attach(`overview-${theme}-${width}-${zoom}.png`, { path: screenshot, contentType: "image/png" })
		}
	})
}

test("light-theme row actions center their uppercase labels at the untrimmed height", async ({ desktop: { app, page }, backend }) => {
	await backend.open()
	if (await page.locator("html").getAttribute("data-theme") !== "light") await page.getByRole("button", { name: "Toggle color theme" }).click()
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
	const button = row(page, "existing-project").getByRole("button", { name: "Delete", exact: true })
	// The trim keeps the untrimmed height: compare free-standing copies, outside the row's
	// flex layout that stretches its buttons, with and without the trim.
	const [actual, untrimmed] = await button.evaluate(element => {
		const measure = (untrimmed: boolean) => {
			const copy = element.cloneNode(true) as HTMLElement
			copy.style.setProperty("position", "absolute")
			if (untrimmed) {
				copy.style.setProperty("text-box", "normal")
				copy.style.setProperty("padding-block", "0.48rem")
			}
			document.body.append(copy)
			const height = copy.getBoundingClientRect().height
			copy.remove()
			return height
		}
		return [measure(false), measure(true)]
	})
	expect(actual).toBeCloseTo(untrimmed, 1)
	const png = await button.screenshot({ animations: "disabled" })
	const { height, inkRows } = await app.evaluate(({ nativeImage }, data) => {
		const image = nativeImage.createFromBuffer(Buffer.from(data, "base64"))
		const { width, height } = image.getSize()
		const bitmap = image.toBitmap()
		const pixel = (x: number, y: number) => [...bitmap.subarray((y * width + x) * 4, (y * width + x) * 4 + 3)]
		const background = pixel(Math.floor(width / 2), 3)
		const inkRows: number[] = []
		// Skip the border and rounded corners; a row has ink when a pixel departs from the fill.
		for (let y = 2; y < height - 2; y++) {
			for (let x = 6; x < width - 6; x++) {
				if (pixel(x, y).reduce((sum, value, index) => sum + Math.abs(value - background[index]), 0) > 90) { inkRows.push(y); break }
			}
		}
		return { height, inkRows }
	}, png.toString("base64"))
	const above = inkRows[0] - 1
	const below = height - 2 - inkRows[inkRows.length - 1]
	expect(Math.abs(above - below)).toBeLessThanOrEqual(1)
})
