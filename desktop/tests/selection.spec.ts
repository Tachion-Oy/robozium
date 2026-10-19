import { expect, type Page } from "@playwright/test"
import type { ServerResponse } from "node:http"
import { writeFile } from "node:fs/promises"
import { test, catalogue, json } from "./selection-fixture"
import { captureNative, chooseModel, chooseView as view, modelTrigger, setNativeViewport } from "./native"

const notices = (page: Page) => page.locator(".desktop-interim-content__notices")

test("project creation is single-submit and a failed follow-up refresh cannot recreate it", async ({ desktop: { page }, backend }) => {
	let created: ServerResponse | undefined
	backend.handlers.set("POST /projects", (response, body) => { expect(body).toEqual({ name: "New project" }); created = response })
	await backend.open()
	const existing = page.getByRole("button", { name: "existing-project", exact: true })
	await existing.focus()
	await existing.press("Space")
	await expect(existing).toHaveAttribute("aria-pressed", "true")
	const input = page.getByRole("textbox", { name: "Project name" })
	await input.fill("New project")
	await input.press("Enter")
	await expect(page.getByText("Creating project…", { exact: true })).toBeVisible()
	await input.press("Enter")
	await page.getByRole("button", { name: "Create project" }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click() })
	await expect(input).toBeFocused()
	expect(backend.requests.filter(request => request.method === "POST")).toHaveLength(1)
	backend.handlers.set("GET /projects", response => json(response, { detail: "Refresh unavailable" }, 503))
	json(created!, { slug: "new-project" })
	await expect(page.getByRole("alert")).toContainText("Could not refresh projects")
	await expect(page.getByText("Selected project: new-project", { exact: true })).toBeVisible()
	await expect(input).toHaveValue("")
	await expect(input).toBeFocused()
	await expect(existing).toBeVisible()
	await page.getByRole("button", { name: "Refresh", exact: true }).click()
	await expect(page.getByRole("alert")).toContainText("Refresh unavailable")
	expect(backend.requests.filter(request => request.method === "POST")).toHaveLength(1)
	await input.fill("Keep this draft")
	await view(page, "Environment")
	await view(page, "Runs Overview")
	await expect(input).toHaveValue("Keep this draft")
	await expect(page.getByText("Selected project: new-project", { exact: true })).toBeVisible()
})

test("rejected and malformed creation retain the name, selection, and keyboard focus", async ({ desktop: { page }, backend }) => {
	await backend.open()
	await page.getByRole("button", { name: "existing-project", exact: true }).click()
	const input = page.getByRole("textbox", { name: "Project name" })
	await input.fill("Keep me")
	for (const [body, status] of [[{ detail: "Already exists" }, 409], [{ slug: 42 }, 200]] as const) {
		backend.handlers.set("POST /projects", response => json(response, body, status))
		await input.press("Enter")
		await expect(page.getByRole("alert")).toContainText("Could not create project")
		await expect(input).toHaveValue("Keep me")
		await expect(input).toBeFocused()
		await expect(page.getByRole("button", { name: "existing-project", exact: true })).toHaveAttribute("aria-pressed", "true")
	}
})

test("model changes await acknowledgement, reject duplicate writes, and retry by choosing again", async ({ desktop: { page }, backend }) => {
	let pending: ServerResponse | undefined
	backend.handlers.set("POST /models", (response, body) => { expect(body).toEqual({ model_id: "two" }); pending = response })
	await backend.open()
	const model = modelTrigger(page)
	await expect(model).toHaveAttribute("title", "First model")
	await chooseModel(page, "Second model")
	await expect(model).toHaveAttribute("title", "First model")
	await model.click()
	await expect(page.getByRole("option", { name: "Second model", exact: true })).toBeDisabled()
	await page.keyboard.press("Escape")
	expect(backend.requests.filter(request => request.method === "POST")).toHaveLength(1)
	json(pending!, { detail: "Selection rejected" }, 400)
	await expect(page.getByRole("alert")).toContainText("Selection rejected")
	await expect(model).toHaveAttribute("title", "First model")
	await chooseModel(page, "Second model")
	await expect.poll(() => backend.requests.filter(request => request.method === "POST").length).toBe(2)
	json(pending!, { ...catalogue, selected_model_id: "two" })
	await expect(model).toHaveAttribute("title", "Second model")
	await expect(page.getByRole("alert")).toHaveCount(0)
	await view(page, "Environment")
	await expect(model).toHaveAttribute("title", "Second model")
})

test("empty catalogues and malformed lists stay accessible and recover through reads", async ({ desktop: { page }, backend }) => {
	backend.handlers.set("GET /projects", response => json(response, []))
	backend.handlers.set("GET /models", response => json(response, { models: [], selected_model_id: "" }))
	await backend.open()
	await expect(page.getByText("No projects yet.", { exact: true })).toBeVisible()
	const model = modelTrigger(page)
	await expect(model).toHaveAttribute("title", "Model")
	backend.handlers.set("GET /models", response => json(response, { models: [{ model_id: "one", label: 42 }], selected_model_id: "one" }))
	// Opening an empty selector re-reads the catalogue.
	await model.click()
	await expect(page.getByRole("listbox", { name: "Base model" })).toContainText("Models unavailable")
	await expect(page.getByRole("alert")).toContainText("invalid selection response")
	await page.keyboard.press("Escape")
	backend.handlers.set("GET /models", response => json(response, catalogue))
	await model.click()
	await expect(model).toHaveAttribute("title", "First model")
	await page.keyboard.press("Escape")
	backend.handlers.set("GET /projects", response => json(response, [{ slug: "one" }, { slug: "one" }]))
	await page.getByRole("button", { name: "Refresh", exact: true }).click()
	await expect(page.getByRole("alert")).toContainText("Could not refresh projects")
})

test("obsolete project reads are cancelled on refresh and navigation, with ten-second deadlines", async ({ desktop: { page }, backend }) => {
	await backend.open()
	await expect(page.getByRole("button", { name: "existing-project", exact: true })).toBeVisible()
	const reads: ServerResponse[] = []
	let closed = 0
	backend.handlers.set("GET /projects", response => { reads.push(response); response.on("close", () => closed++) })
	const refresh = page.getByRole("button", { name: "Refresh", exact: true })
	await refresh.click()
	await expect.poll(() => reads.length).toBe(1)
	await refresh.click()
	await expect.poll(() => closed).toBe(1)
	await expect.poll(() => reads.length).toBe(2)
	await view(page, "Environment")
	await expect.poll(() => closed).toBe(2)
	await view(page, "Runs Overview")
	await expect.poll(() => reads.length).toBe(3)
	await page.clock.install()
	// Start a new read with its deadline under the test clock.
	await refresh.click()
	await expect.poll(() => reads.length).toBe(4)
	await page.clock.fastForward(10_001)
	await expect(page.getByRole("alert")).toContainText("Request timed out")
	await expect(page.getByRole("button", { name: "existing-project", exact: true })).toBeVisible()
	await expect(refresh).toBeFocused()
	await expect.poll(() => closed).toBe(4)
	backend.handlers.set("GET /projects", response => json(response, [{ slug: "fresh-project" }]))
	await refresh.click()
	await expect(page.getByRole("button", { name: "fresh-project" })).toBeVisible()
	json(reads[0], [{ slug: "obsolete-project" }])
	await expect(page.getByRole("button", { name: "obsolete-project" })).toHaveCount(0)
})

for (const theme of ["dark", "light"]) {
	test(`connected selections fit long names and narrow zoomed windows in ${theme}`, async ({ desktop: { app, page }, backend }, testInfo) => {
		const longName = "project-" + "long-name-".repeat(20)
		backend.handlers.set("GET /projects", response => json(response, [{ slug: longName }, { slug: "short" }]))
		backend.handlers.set("GET /models", response => json(response, { models: [{ model_id: "one", label: longName }], selected_model_id: "one" }))
		await backend.open()
		await page.getByRole("list", { name: "Projects" }).getByRole("button", { name: longName, exact: true }).click()
		if (theme === "light") await page.getByRole("button", { name: "Toggle color theme" }).click()
		for (const [width, height, zoom] of [[1260, 780, 1], [640, 420, 1], [640, 420, 1.25]]) {
			await setNativeViewport(app, page, width, height, zoom)
			await page.getByRole("textbox", { name: "Project name" }).fill("Keyboard draft")
			expect(await page.evaluate(() => document.documentElement.scrollHeight === innerHeight
				&& document.documentElement.scrollWidth === innerWidth)).toBe(true)
			const region = page.locator(".selection-overview")
			expect(await region.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
			await region.evaluate(element => element.scrollTop = 0)
			const screenshot = testInfo.outputPath(`selections-${theme}-${width}-${zoom}.png`)
			await writeFile(screenshot, (await captureNative(app, page, width, height))!)
			await testInfo.attach(`selections-${theme}-${width}-${zoom}.png`, { path: screenshot, contentType: "image/png" })
		}
	})
}

test("write deadlines retain confirmed state and drafts without automatic retries", async ({ desktop: { page }, backend }) => {
	let closed = 0
	const stall = (response: ServerResponse) => response.on("close", () => closed++)
	backend.handlers.set("POST /projects", stall)
	backend.handlers.set("POST /models", stall)
	await backend.open()
	await page.clock.install()
	const input = page.getByRole("textbox", { name: "Project name" })
	await input.fill("Uncertain creation")
	await input.press("Enter")
	await expect.poll(() => backend.requests.filter(request => request.method === "POST").length).toBe(1)
	await page.clock.fastForward(10_001)
	await expect(page.getByRole("alert")).toContainText("Request timed out")
	await expect(input).toHaveValue("Uncertain creation")
	await expect(input).toBeFocused()
	await expect.poll(() => closed).toBe(1)
	const model = modelTrigger(page)
	await chooseModel(page, "Second model")
	await expect.poll(() => backend.requests.filter(request => request.method === "POST").length).toBe(2)
	await page.clock.fastForward(10_001)
	await expect(notices(page).getByRole("alert")).toContainText("Request timed out")
	await expect(model).toHaveAttribute("title", "First model")
	await expect.poll(() => closed).toBe(2)
	await page.clock.fastForward(30_000)
	expect(backend.requests.filter(request => request.method === "POST")).toHaveLength(2)
})

test("reload cancels pending writes and resets only local project state", async ({ desktop: { page }, backend }) => {
	let closed = 0
	const stall = (response: ServerResponse) => response.on("close", () => closed++)
	backend.handlers.set("POST /projects", stall)
	backend.handlers.set("POST /models", stall)
	await backend.open()
	await page.getByRole("button", { name: "existing-project", exact: true }).click()
	const input = page.getByRole("textbox", { name: "Project name" })
	await input.fill("Pending")
	await input.press("Enter")
	const model = modelTrigger(page)
	await chooseModel(page, "Second model")
	await expect.poll(() => backend.requests.filter(request => request.method === "POST").length).toBe(2)
	await page.reload()
	await expect.poll(() => closed).toBe(2)
	await expect(page.getByText("Selected project: None", { exact: true })).toBeVisible()
	await expect(input).toHaveValue("")
	await expect(model).toHaveAttribute("title", "First model")
})

test("model read timeout and malformed acknowledgement preserve the confirmed choice", async ({ desktop: { page }, backend }) => {
	let read: ServerResponse | undefined
	backend.handlers.set("GET /models", response => { read = response })
	await backend.open()
	await page.clock.install()
	// Reload to put the initial catalogue deadline under the controlled clock.
	await page.reload()
	await expect(page.locator(".agent-hud__model-selector--loading")).toHaveText("Loading models")
	await page.clock.fastForward(10_001)
	await expect(page.getByRole("alert")).toContainText("Request timed out")
	expect(read).toBeDefined()
	backend.handlers.set("GET /models", response => json(response, catalogue))
	const model = modelTrigger(page)
	await expect(model).toHaveAttribute("title", "Model")
	await model.click()
	await expect(model).toHaveAttribute("title", "First model")
	await page.keyboard.press("Escape")
	backend.handlers.set("POST /models", response => json(response, { ...catalogue, selected_model_id: "unknown" }))
	await chooseModel(page, "Second model")
	await expect(page.getByRole("alert")).toContainText("invalid selection response")
	await expect(model).toHaveAttribute("title", "First model")
})

for (const recovery of ["refresh", "reselect"] as const) {
	test(`a committed model write with a lost response recovers through ${recovery}`, async ({ desktop: { page }, backend }) => {
		let selected = "one"
		backend.handlers.set("GET /models", response => json(response, { ...catalogue, selected_model_id: selected }))
		// Commit the choice but withhold acknowledgement, as a lost response would.
		backend.handlers.set("POST /models", (_response, body) => { selected = (body as { model_id: string }).model_id })
		await backend.open()
		const model = modelTrigger(page)
		await expect(model).toHaveAttribute("title", "First model")
		await page.clock.install()
		await chooseModel(page, "Second model")
		await expect.poll(() => selected).toBe("two")
		await page.clock.fastForward(10_001)
		await expect(notices(page).getByRole("alert")).toContainText("Request timed out")
		await expect(model).toHaveAttribute("title", "First model")
		if (recovery === "refresh") {
			// Opening the selector after a failure reads the committed choice.
			await model.click()
			await expect(model).toHaveAttribute("title", "Second model")
			await page.keyboard.press("Escape")
			expect(backend.requests.filter(request => request.method === "POST")).toHaveLength(1)
		} else {
			backend.handlers.set("POST /models", (response, body) => {
				selected = (body as { model_id: string }).model_id
				json(response, { ...catalogue, selected_model_id: selected })
			})
			await chooseModel(page, "First model")
			await expect.poll(() => selected).toBe("one")
			await expect(model).toHaveAttribute("title", "First model")
			expect(backend.requests.filter(request => request.method === "POST").map(request => request.body))
				.toEqual([{ model_id: "two" }, { model_id: "one" }])
		}
		await expect(notices(page)).toHaveCount(0)
	})
}

test("reconnect refreshes backend models while preserving local project state and cancelling obsolete reads", async ({ desktop: { page }, backend }) => {
	let selected = "one"
	backend.handlers.set("GET /models", response => json(response, { ...catalogue, selected_model_id: selected }))
	backend.handlers.set("POST /models", (response, body) => {
		selected = (body as { model_id: string }).model_id
		json(response, { ...catalogue, selected_model_id: selected })
	})
	await page.clock.install()
	await backend.open()
	const model = modelTrigger(page)
	await expect(model).toHaveAttribute("title", "First model")
	await page.getByRole("button", { name: "existing-project", exact: true }).click()
	const draft = page.getByRole("textbox", { name: "Project name" })
	await draft.fill("Retained project draft")
	await chooseModel(page, "Second model")
	await expect(model).toHaveAttribute("title", "Second model")
	await view(page, "Environment")
	let obsolete: ServerResponse | undefined
	let closed = false
	// The first reconnect's catalogue read stays in flight through a second outage.
	backend.handlers.set("GET /models", response => { obsolete = response; response.on("close", () => { closed = true }) })
	backend.handlers.set("GET /ready", response => json(response, { detail: "Restarting" }, 503))
	await page.clock.fastForward(5_001)
	await expect(page.locator(".backend-notice").getByRole("alert")).toContainText("Backend connection unavailable")
	backend.handlers.set("GET /ready", response => json(response, { status: "ready" }))
	await page.locator(".backend-notice").getByRole("button", { name: "Retry", exact: true }).click()
	await expect(page.locator(".backend-notice")).toHaveCount(0)
	await expect.poll(() => obsolete).toBeDefined()
	backend.handlers.set("GET /ready", response => json(response, { detail: "Restarting" }, 503))
	await page.clock.fastForward(5_001)
	await expect(page.locator(".backend-notice").getByRole("alert")).toContainText("Backend connection unavailable")
	await expect.poll(() => closed).toBe(true)
	selected = "one" // The restarted backend restores its configured default.
	backend.handlers.set("GET /models", response => json(response, { ...catalogue, selected_model_id: selected }))
	backend.handlers.set("GET /ready", response => json(response, { status: "ready" }))
	await page.locator(".backend-notice").getByRole("button", { name: "Retry", exact: true }).click()
	await expect(page.locator(".backend-notice")).toHaveCount(0)
	await expect(model).toHaveAttribute("title", "First model")
	json(obsolete!, { ...catalogue, selected_model_id: "two" })
	const readinessCount = backend.requests.filter(request => request.path === "/ready").length
	await page.clock.fastForward(5_001)
	await expect.poll(() => backend.requests.filter(request => request.path === "/ready").length).toBeGreaterThan(readinessCount)
	expect(backend.requests.filter(request => request.method === "GET" && request.path === "/models")).toHaveLength(3)
	expect(backend.requests.filter(request => request.method === "POST")).toHaveLength(1)
	await expect(model).toHaveAttribute("title", "First model")
	await view(page, "Runs Overview")
	await expect(draft).toHaveValue("Retained project draft")
	await expect(page.getByRole("button", { name: "existing-project", exact: true })).toHaveAttribute("aria-pressed", "true")
})

test("recovery reconciles a pending model write without replaying it", async ({ desktop: { page }, backend }) => {
	let selected = "one"
	let closed = false
	backend.handlers.set("GET /models", response => json(response, { ...catalogue, selected_model_id: selected }))
	backend.handlers.set("POST /models", (response, body) => {
		selected = (body as { model_id: string }).model_id
		response.on("close", () => { closed = true })
	})
	await page.clock.install()
	await backend.open()
	const model = modelTrigger(page)
	await expect(model).toHaveAttribute("title", "First model")
	await chooseModel(page, "Second model")
	await expect.poll(() => selected).toBe("two")
	backend.handlers.set("GET /ready", response => json(response, { detail: "Unavailable" }, 503))
	await page.clock.fastForward(5_001)
	await expect(page.locator(".backend-notice").getByRole("alert")).toContainText("Backend connection unavailable")
	await expect.poll(() => closed).toBe(true)
	backend.handlers.set("GET /ready", response => json(response, { status: "ready" }))
	backend.handlers.set("GET /models", response => json(response, { detail: "Not yet available" }, 503))
	await page.locator(".backend-notice").getByRole("button", { name: "Retry", exact: true }).click()
	await expect(page.locator(".backend-notice")).toHaveCount(0)
	await expect(notices(page).getByRole("alert")).toContainText("Not yet available")
	await expect(model).toHaveAttribute("title", "First model")
	backend.handlers.set("GET /models", response => json(response, { ...catalogue, selected_model_id: selected }))
	await model.click()
	await expect(model).toHaveAttribute("title", "Second model")
	await page.keyboard.press("Escape")
	expect(backend.requests.filter(request => request.method === "POST")).toHaveLength(1)
})
