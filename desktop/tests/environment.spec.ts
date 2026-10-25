import { expect, type Page } from "@playwright/test"
import type { ServerResponse } from "node:http"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
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
	// The password is asked for only in the dialog, twice for a new encryption.
	await expect(saveForm(page).getByLabel("Encryption password")).toHaveCount(0)
	const submit = saveForm(page).getByRole("button", { name: "Encrypt and save" })
	await submit.click()
	const prompt = page.getByRole("dialog", { name: "Encrypt and save" })
	await expect(prompt.getByLabel("Encryption password")).toBeFocused()
	await prompt.getByLabel("Encryption password").fill("test password")
	await prompt.getByLabel("Confirm password").fill("other")
	await prompt.getByRole("button", { name: "Encrypt and save" }).click()
	await expect(prompt.getByRole("alert")).toHaveText("The passwords do not match.")
	expect(saves(backend)).toHaveLength(0)
	await prompt.getByLabel("Encryption password").fill("test password")
	await prompt.getByLabel("Confirm password").fill("test password")
	await prompt.getByRole("button", { name: "Encrypt and save" }).click()
	await expect(prompt).toHaveCount(0)
	await expect(page.getByRole("status").filter({ hasText: "Settings saved" })).toContainText("then enter your password")
	expect(saves(backend).map(request => request.body)).toEqual([{
		revision: "r1", entries: [{ name: "API_KEY", value: "throwaway", secret: true }], password: "test password",
	}])
})

test("saved encryption asks for its password once, and a refused save keeps the dialog open", async ({ desktop: { page }, backend }) => {
	backend.handlers.set("GET /credentials/environment", response => json(response, environment({ requires_password: true, entries: [entry("API_KEY", null, true), entry("A", "1")] })))
	backend.handlers.set("POST /credentials/environment", response => json(response, { detail: "Wrong password" }, 400))
	await openEnvironment(page, backend)
	await panel(page).getByRole("button", { name: "Change A", exact: true }).click()
	await editor(page).getByLabel("Value for A").fill("2")
	await editor(page).getByRole("button", { name: "Apply" }).click()
	await saveForm(page).getByRole("button", { name: "Encrypt and save" }).click()
	const prompt = page.getByRole("dialog", { name: "Encrypt and save" })
	await expect(prompt.getByLabel("Confirm password")).toHaveCount(0)
	await prompt.getByLabel("Encryption password").fill("wrong")
	await prompt.getByLabel("Encryption password").press("Enter")
	await expect(prompt.getByRole("alert")).toHaveText("The settings were not saved.")
	await expect(alert(page, "Could not save settings")).toContainText("Wrong password")
	await prompt.getByRole("button", { name: "Cancel" }).click()
	await expect(prompt).toHaveCount(0)
	await expect(panel(page).getByLabel("Current value for A", { exact: true })).toHaveText("2")
	expect(saves(backend).map(request => (request.body as { password: string }).password)).toEqual(["wrong"])
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

test("importing a folder uploads each file under its relative path and asks for a restart", async ({ desktop: { page }, backend }, testInfo) => {
	const folder = testInfo.outputPath("local_tool")
	await mkdir(path.join(folder, "nested"), { recursive: true })
	await writeFile(path.join(folder, "__init__.py"), "")
	await writeFile(path.join(folder, ".env.example"), "LOCAL_TOOL_KEY=\n")
	await writeFile(path.join(folder, "nested", "helper.py"), "")
	let current = environment()
	backend.handlers.set("GET /credentials/environment", response => json(response, current))
	backend.handlers.set("POST /credentials/environment/import", response => json(response, { detail: "An imported folder named local_tool already exists" }, 409))
	await openEnvironment(page, backend)
	const picker = panel(page).getByLabel("Choose tool or skill folder")
	await picker.setInputFiles(folder)
	await expect(alert(page, "Import failed")).toContainText("already exists")
	await expect(panel(page).getByLabel("Selected tool or skill folder")).toHaveValue("local_tool")
	const imported = { name: "local_tool", active: false, variables: ["LOCAL_TOOL_KEY"],
		capabilities: [{ name: "local_tool", kind: "tool", selectable: true, loading: null }] }
	backend.handlers.set("POST /credentials/environment/import", response => {
		current = environment({ imports: [imported] })
		json(response, { imported, suggestions: [{ name: "LOCAL_TOOL_KEY", value: "", secret: false, source: "local_tool" }] })
	})
	await panel(page).getByRole("button", { name: "Import", exact: true }).click()
	await expect(page.getByRole("status").filter({ hasText: "Imported" })).toContainText("Tool local_tool found and imported. Available after restart.")
	await expect(panel(page).getByRole("status").filter({ hasText: "Restart to apply your changes." })).toBeVisible()
	await expect(panel(page)).toContainText("Available on next start")
	const uploads = backend.requests.filter(request => request.path === "/credentials/environment/import")
	expect(uploads).toHaveLength(2)
	for (const name of ["local_tool/__init__.py", "local_tool/.env.example", "local_tool/nested/helper.py"]) {
		expect(uploads[1].body).toContain(`name="files"; filename="${name}"`)
	}
})

test("removing an import asks for confirmation, keeps it on failure, and asks for a restart", async ({ desktop: { page }, backend }) => {
	const imported = { name: "local_tool", active: true, variables: [],
		capabilities: [{ name: "local_tool", kind: "tool", selectable: true, loading: null }] }
	let current = environment({ imports: [imported] })
	backend.handlers.set("GET /credentials/environment", response => json(response, current))
	backend.handlers.set("DELETE /credentials/environment/imports/local_tool", response => json(response, { detail: "Stop all runs first" }, 409))
	await openEnvironment(page, backend)
	const imports = panel(page).getByRole("region", { name: "Tools & skills" })
	await imports.getByRole("button", { name: "Remove local_tool" }).click()
	await imports.getByRole("button", { name: "Confirm removing local_tool" }).click()
	await expect(alert(page, "Remove failed")).toContainText("Stop all runs first")
	await expect(imports.getByText("local tool", { exact: true })).toBeVisible()
	backend.handlers.set("DELETE /credentials/environment/imports/local_tool", response => {
		current = environment()
		json(response, { status: "removed" })
	})
	await imports.getByRole("button", { name: "Remove local_tool" }).click()
	await imports.getByRole("button", { name: "Confirm removing local_tool" }).click()
	await expect(page.getByRole("status").filter({ hasText: "Removed" })).toContainText("Removed local_tool. Takes effect after restart.")
	await expect(imports).toContainText("No imports yet.")
	await expect(panel(page).getByRole("status").filter({ hasText: "Restart to apply your changes." })).toBeVisible()
	expect(backend.requests.filter(request => request.method === "DELETE" && request.path === "/credentials/environment/imports/local_tool")).toHaveLength(2)
})

test("Restart app confirms unsaved edits in the HUD before restarting", async ({ desktop: { app, page }, backend }) => {
	await app.evaluate(({ ipcMain }) => {
		ipcMain.removeHandler("desktop:relaunch")
		ipcMain.handle("desktop:relaunch", () => { Reflect.set(globalThis, "relaunches", (Reflect.get(globalThis, "relaunches") ?? 0) + 1) })
	})
	const relaunches = () => app.evaluate(() => Reflect.get(globalThis, "relaunches") ?? 0)
	backend.handlers.set("GET /credentials/environment", response => json(response, environment({ entries: [entry("A", "1")] })))
	await openEnvironment(page, backend)
	await panel(page).getByRole("button", { name: "Delete A" }).click()
	await panel(page).getByRole("button", { name: "Restart app" }).click()
	await expect(panel(page).getByRole("alert")).toHaveText("Restart without saving your environment changes? Unsaved changes will be lost.")
	await panel(page).getByRole("button", { name: "Keep editing" }).click()
	expect(await relaunches()).toBe(0)
	await panel(page).getByRole("button", { name: "Restart app" }).click()
	await panel(page).getByRole("button", { name: "Restart", exact: true }).click()
	await expect.poll(relaunches).toBe(1)
	await expect(panel(page).getByRole("button", { name: "Restarting…" })).toBeDisabled()
	// The loading screen stays until the app exits; this stub never does.
	await expect(page.locator(".startup[data-stage='loading']")).toBeVisible()
})
