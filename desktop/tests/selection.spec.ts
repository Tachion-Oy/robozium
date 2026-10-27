import { expect, type Page } from "@playwright/test"
import type { ServerResponse } from "node:http"
import { test, catalogue, json } from "./selection-fixture"
import { chooseModel, chooseView as view, modelTrigger, reloadApp } from "./native"
import { prepareRun, start, launchButton } from "./run-fixture"

const notices = (page: Page) => page.locator(".desktop-interim-content__notices")

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

test("empty and malformed model catalogues stay accessible and recover through reads", async ({ desktop: { page }, backend }) => {
	backend.handlers.set("GET /models", response => json(response, { models: [], selected_model_id: "" }))
	await backend.open()
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
})

test("write deadlines retain the confirmed model without automatic retries", async ({ desktop: { page }, backend }) => {
	let closed = 0
	const stall = (response: ServerResponse) => response.on("close", () => closed++)
	backend.handlers.set("POST /models", stall)
	await backend.open()
	await page.clock.install()
	const model = modelTrigger(page)
	await chooseModel(page, "Second model")
	await expect.poll(() => backend.requests.filter(request => request.method === "POST").length).toBe(1)
	await page.clock.fastForward(10_001)
	await expect(notices(page).getByRole("alert")).toContainText("Request timed out")
	await expect(model).toHaveAttribute("title", "First model")
	await expect.poll(() => closed).toBe(1)
	await page.clock.fastForward(30_000)
	expect(backend.requests.filter(request => request.method === "POST")).toHaveLength(1)
})

test("reload cancels a pending model write and keeps the confirmed model", async ({ desktop: { page }, backend }) => {
	let closed = 0
	backend.handlers.set("POST /models", response => response.on("close", () => closed++))
	await backend.open()
	const model = modelTrigger(page)
	await chooseModel(page, "Second model")
	await expect.poll(() => backend.requests.filter(request => request.method === "POST").length).toBe(1)
	await reloadApp(page)
	await expect.poll(() => closed).toBe(1)
	await expect(model).toHaveAttribute("title", "First model")
})

test("model read timeout and malformed acknowledgement preserve the confirmed choice", async ({ desktop: { page }, backend }) => {
	let read: ServerResponse | undefined
	backend.handlers.set("GET /models", response => { read = response })
	await backend.open()
	await page.clock.install()
	// Reload to put the initial catalogue deadline under the controlled clock.
	await reloadApp(page)
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

test("reconnect refreshes backend models while preserving the overview and cancelling obsolete reads", async ({ desktop: { page }, backend }) => {
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
	await expect(launchButton(page, "existing-project")).toBeVisible()
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

test("Current Run shows and switches its run's model, and the other screens keep the default", async ({ desktop: { page }, backend }) => {
	prepareRun(backend)
	const selected = { default: "one", run: "two" }
	const posts: unknown[] = []
	backend.handlers.set("GET /models", response => json(response, { ...catalogue, selected_model_id: selected.default }))
	backend.handlers.set("GET /models?run_id=run-one", response => json(response, { ...catalogue, selected_model_id: selected.run }))
	backend.handlers.set("POST /models", (response, body) => {
		const { model_id, run_id } = body as { model_id: string; run_id?: string }
		posts.push(body)
		selected[run_id === "run-one" ? "run" : "default"] = model_id
		json(response, { ...catalogue, selected_model_id: model_id })
	})
	await start(page, backend)
	const model = modelTrigger(page)
	await expect(model).toHaveAttribute("title", "Second model")
	await view(page, "Runs Overview")
	await expect(model).toHaveAttribute("title", "First model")
	await view(page, "Current Run")
	await expect(model).toHaveAttribute("title", "Second model")
	// Switching mid-run changes only this run, as before an image reply to a vision model.
	await chooseModel(page, "First model")
	await expect(model).toHaveAttribute("title", "First model")
	await view(page, "Runs Overview")
	await expect(model).toHaveAttribute("title", "First model")
	await chooseModel(page, "Second model")
	await expect(model).toHaveAttribute("title", "Second model")
	await view(page, "Current Run")
	await expect(model).toHaveAttribute("title", "First model")
	expect(posts).toEqual([{ model_id: "one", run_id: "run-one" }, { model_id: "two" }])
})
