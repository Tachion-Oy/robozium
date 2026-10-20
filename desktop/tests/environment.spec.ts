import { expect, type Page } from "@playwright/test"
import type { ServerResponse } from "node:http"
import { writeFile } from "node:fs/promises"
import { test, json, view } from "./run-fixture"
import { captureNative, setNativeViewport } from "./native"
import type { Backend } from "./selection-fixture"

type Entry = { name: string; value: string | null; secret: boolean; configured: boolean; overridden: boolean; startup: boolean }
const entry = (name: string, value: string | null, secret = false): Entry =>
	({ name, value, secret, configured: true, overridden: false, startup: false })
const environment = (overrides: Record<string, unknown> = {}) => ({
	revision: "r1", entries: [] as Entry[], overrides: [], requires_password: false, editable: true,
	suggestions: [], example_errors: [], imports: [], ...overrides,
})
const panel = (page: Page) => page.getByRole("region", { name: "Environment settings" })
const editor = (page: Page) => page.getByRole("form", { name: "Variable editor" })
const saveForm = (page: Page) => page.getByRole("form", { name: "Save environment settings" })
const saves = (backend: Backend) => backend.requests.filter(request => request.method === "POST" && request.path === "/credentials/environment")
const alert = (page: Page, title: string) => page.getByRole("alert").filter({ hasText: title })

async function openEnvironment(page: Page, backend: Backend) {
	await backend.open()
	await view(page, "Environment")
	await expect(panel(page)).toBeVisible()
}

test("a failed load offers Retry, then the variables show with secrets masked", async ({ desktop: { page }, backend }) => {
	backend.handlers.set("GET /credentials/environment", response => json(response, { detail: "Storage unavailable" }, 503))
	await openEnvironment(page, backend)
	await expect(alert(page, "Could not load settings")).toContainText("Storage unavailable")
	backend.handlers.set("GET /credentials/environment", response => json(response, environment({
		entries: [entry("PLAIN_SETTING", "visible"), entry("API_KEY", null, true)], overrides: ["API_KEY"],
	})))
	await panel(page).getByRole("button", { name: "Retry" }).click()
	await expect(panel(page).getByLabel("Current value for PLAIN_SETTING")).toHaveText("visible")
	await expect(panel(page).getByLabel("Current value for API_KEY")).toHaveText("●●●●●●●●")
	await expect(panel(page)).toContainText("Manual .env overrides: API_KEY.")
})

test("editing is unavailable while runs or background work are active", async ({ desktop: { page }, backend }) => {
	backend.handlers.set("GET /credentials/environment", response => json(response, environment({ editable: false, entries: [entry("A", "1")] })))
	await openEnvironment(page, backend)
	await expect(panel(page).getByRole("status")).toHaveText("Stop all runs and background work before editing.")
	await expect(panel(page).getByRole("button", { name: "Add variable" })).toBeDisabled()
	await expect(saveForm(page).getByRole("button", { name: "Reset environment" })).toBeDisabled()
})

test("a new secret is validated, encrypted with a confirmed password and saved once", async ({ desktop: { page }, backend }) => {
	let current = environment()
	backend.handlers.set("GET /credentials/environment", response => json(response, current))
	backend.handlers.set("POST /credentials/environment", response => {
		current = environment({ revision: "r2", requires_password: true, entries: [entry("API_KEY", null, true)] })
		json(response, { status: "saved" })
	})
	await openEnvironment(page, backend)
	await panel(page).getByRole("button", { name: "Add variable" }).click()
	await editor(page).getByLabel("Name").fill("API_KEY_ENCRYPTED")
	await editor(page).getByLabel("Value for API_KEY_ENCRYPTED").fill("throwaway")
	await editor(page).getByRole("button", { name: "Apply" }).click()
	await expect(alert(page, "Invalid variable")).toContainText("reserved _ENCRYPTED suffix")
	await editor(page).getByLabel("Name").fill("API_KEY")
	await editor(page).getByRole("checkbox", { name: "Secret" }).click()
	await expect(editor(page).getByLabel("Value for API_KEY")).toHaveAttribute("type", "password")
	await editor(page).getByRole("button", { name: "Apply" }).click()
	await expect(panel(page).getByLabel("Current value for API_KEY")).toHaveText("●●●●●●●●")
	const submit = saveForm(page).getByRole("button", { name: "Encrypt and save" })
	await submit.click()
	await expect(alert(page, "Encryption password required")).toBeVisible()
	await saveForm(page).getByLabel("Encryption password", { exact: true }).fill("test password")
	await saveForm(page).getByLabel("Confirm encryption password").fill("other")
	await submit.click()
	await expect(alert(page, "Passwords do not match")).toBeVisible()
	expect(saves(backend)).toHaveLength(0)
	await saveForm(page).getByLabel("Encryption password", { exact: true }).fill("test password")
	await saveForm(page).getByLabel("Confirm encryption password").fill("test password")
	await submit.click()
	await expect(page.getByRole("status").filter({ hasText: "Settings saved" })).toContainText("then unlock with Secrets")
	expect(saves(backend).map(request => request.body)).toEqual([{
		revision: "r1", entries: [{ name: "API_KEY", value: "throwaway", secret: true }], password: "test password",
	}])
	// The saved file now needs its password; no confirmation is asked for the next save.
	await expect(saveForm(page).getByLabel("Confirm encryption password")).toHaveCount(0)
	await expect(saveForm(page).getByLabel("Encryption password", { exact: true })).toHaveValue("")
})

test("a refused save keeps the edits, and polling does not overwrite them", async ({ desktop: { page }, backend }) => {
	let reads = 0
	backend.handlers.set("GET /credentials/environment", response => { reads++; json(response, environment({ revision: `r${reads}`, entries: [entry("A", "1")] })) })
	backend.handlers.set("POST /credentials/environment", response => json(response, { detail: "Settings changed elsewhere. Refresh before saving." }, 409))
	await page.clock.install()
	await openEnvironment(page, backend)
	await panel(page).getByRole("button", { name: "Change A" }).click()
	await editor(page).getByLabel("Value for A").fill("2")
	await editor(page).getByRole("button", { name: "Apply" }).click()
	const seen = reads
	await page.clock.fastForward(4001)
	await expect.poll(() => reads).toBeGreaterThan(seen)
	await expect(panel(page).getByLabel("Current value for A")).toHaveText("2")
	await saveForm(page).getByRole("button", { name: "Save" }).click()
	await expect(alert(page, "Could not save settings")).toContainText("Settings changed elsewhere")
	await expect(panel(page).getByLabel("Current value for A")).toHaveText("2")
	await page.clock.fastForward(30_000)
	expect(saves(backend)).toHaveLength(1)
	// The edit was made against the first revision the screen loaded.
	expect(saves(backend)[0].body).toMatchObject({ revision: "r1" })
})

test("edits survive leaving the screen, and Escape closes the open editor", async ({ desktop: { page }, backend }) => {
	backend.handlers.set("GET /credentials/environment", response => json(response, environment({ entries: [entry("A", "1")] })))
	await openEnvironment(page, backend)
	await panel(page).getByRole("button", { name: "Delete A" }).click()
	await expect(panel(page).getByLabel("Current value for A")).toHaveCount(0)
	await view(page, "Runs Overview")
	await view(page, "Environment")
	await expect(panel(page).getByLabel("Current value for A")).toHaveCount(0)
	await expect(saveForm(page).getByRole("button", { name: "Save" })).toBeEnabled()
	const add = panel(page).getByRole("button", { name: "Add variable" })
	await add.click()
	await expect(editor(page)).toBeVisible()
	await page.keyboard.press("Escape")
	await expect(editor(page)).toHaveCount(0)
	await expect(add).toBeFocused()
})

test("reset asks first, then deletes the saved settings once", async ({ desktop: { page }, backend }) => {
	let pending: ServerResponse | undefined
	backend.handlers.set("GET /credentials/environment", response => json(response, environment({ requires_password: true, entries: [entry("API_KEY", null, true)] })))
	backend.handlers.set("DELETE /credentials/environment", response => { pending = response })
	await openEnvironment(page, backend)
	await saveForm(page).getByRole("button", { name: "Reset environment" }).click()
	await expect(saveForm(page)).toContainText("Are you sure? This permanently deletes all saved settings and secrets.")
	await saveForm(page).getByRole("button", { name: "Keep settings" }).click()
	await saveForm(page).getByRole("button", { name: "Reset environment" }).click()
	backend.handlers.set("GET /credentials/environment", response => json(response, environment()))
	await saveForm(page).getByRole("button", { name: "Yes, reset" }).click()
	await expect.poll(() => pending).toBeDefined()
	json(pending!, { status: "reset" })
	await expect(page.getByRole("status").filter({ hasText: "Environment reset" })).toBeVisible()
	await expect(panel(page).getByLabel("Current value for API_KEY")).toHaveCount(0)
	expect(backend.requests.filter(request => request.method === "DELETE")).toHaveLength(1)
})

for (const theme of ["dark", "light"]) {
	test(`the screen fits narrow zoomed windows in ${theme} with an open editor`, async ({ desktop: { app, page }, backend }, testInfo) => {
		const longName = "VERY_LONG_SETTING_" + "NAME_".repeat(20)
		backend.handlers.set("GET /credentials/environment", response => json(response, environment({
			requires_password: true, entries: [entry(longName, "value-".repeat(30)), entry("API_KEY", null, true)],
		})))
		await openEnvironment(page, backend)
		if (theme === "light") await page.getByRole("button", { name: "Toggle color theme" }).click()
		await panel(page).getByRole("button", { name: "Change API_KEY" }).click()
		for (const [width, height, zoom] of [[1260, 780, 1], [640, 420, 1], [640, 420, 1.25]]) {
			await setNativeViewport(app, page, width, height, zoom)
			await expect(editor(page)).toBeVisible()
			await expect(saveForm(page).getByRole("button", { name: "Encrypt and save" })).toBeVisible()
			expect(await page.evaluate(() => document.documentElement.scrollHeight === innerHeight
				&& document.documentElement.scrollWidth === innerWidth)).toBe(true)
			const screenshot = testInfo.outputPath(`environment-${theme}-${width}-${zoom}.png`)
			await writeFile(screenshot, (await captureNative(app, page, width, height))!)
			await testInfo.attach(`environment-${theme}-${width}-${zoom}.png`, { path: screenshot, contentType: "image/png" })
		}
	})
}
