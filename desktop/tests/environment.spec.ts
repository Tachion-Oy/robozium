import { expect, type Page } from "@playwright/test"
import type { ServerResponse } from "node:http"
import { writeFile } from "node:fs/promises"
import { test, json, view } from "./run-fixture"
import { captureNative, setNativeViewport, toast } from "./native"
import type { Backend } from "./selection-fixture"

type Entry = { name: string; value: string | null; secret: boolean; configured: boolean; overridden: boolean }
const entry = (name: string, value: string | null, secret = false): Entry =>
	({ name, value, secret, configured: true, overridden: false })
const environment = (overrides: Record<string, unknown> = {}) => ({
	revision: "r1", entries: [] as Entry[], overrides: [], requires_password: false, editable: true,
	suggestions: [], example_errors: [], repositories: [], ...overrides,
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

test("a failed load offers Retry in a toast, then the variables show with secrets masked", async ({ desktop: { page }, backend }) => {
	backend.handlers.set("GET /credentials/environment", response => json(response, { detail: "Storage unavailable" }, 503))
	await openEnvironment(page, backend)
	const failure = toast(page, "Could not load settings")
	await expect(failure).toContainText("Storage unavailable")
	// The panel keeps its layout: no retry row appears under the lead line.
	await expect(panel(page).getByRole("button", { name: "Retry" })).toHaveCount(0)
	backend.handlers.set("GET /credentials/environment", response => json(response, environment({
		entries: [entry("PLAIN_SETTING", "visible"), entry("API_KEY", null, true)], overrides: ["API_KEY"],
	})))
	await failure.getByRole("button", { name: "Retry" }).click()
	await expect(failure).toHaveCount(0)
	await expect(panel(page).getByLabel("Current value for PLAIN_SETTING")).toHaveText("visible")
	await expect(panel(page).getByLabel("Current value for API_KEY")).toHaveText("●●●●●●●●")
	await expect(panel(page)).toContainText("Manual .env overrides: API_KEY.")
})

test("editing is unavailable while runs or background work are active", async ({ desktop: { page }, backend }) => {
	backend.handlers.set("GET /credentials/environment", response => json(response, environment({ editable: false, entries: [entry("A", "1")] })))
	await openEnvironment(page, backend)
	await expect(toast(page, "Editing paused")).toContainText("Stop all runs and background work before editing.")
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
	const confirm = toast(page, "Reset environment?")
	await expect(confirm).toContainText("This permanently deletes all saved settings and secrets.")
	await confirm.getByRole("button", { name: "Keep settings" }).click()
	await expect(confirm).toHaveCount(0)
	await saveForm(page).getByRole("button", { name: "Reset environment" }).click()
	backend.handlers.set("GET /credentials/environment", response => json(response, environment()))
	await confirm.getByRole("button", { name: "Yes, reset" }).click()
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

const toolkit = (active: boolean, name = "alpha_tool") => ({
	name: "toolkit", url: "https://github.com/acme/toolkit", private: true,
	packages: [{ name: "alpha", active, variables: [], capabilities: [{ name, kind: "tool", selectable: true, loading: null }] }],
})
const repositoryRequests = (backend: Backend) => backend.requests.filter(request => request.path.startsWith("/credentials/environment/repositories"))

test("adding a private repository asks for the password, keeps the dialog on refusal, and lists its packages", async ({ desktop: { page }, backend }) => {
	let current = environment({ requires_password: true })
	backend.handlers.set("GET /credentials/environment", response => json(response, current))
	backend.handlers.set("POST /credentials/environment/repositories", response => json(response, { detail: "Invalid encrypted secret or password" }, 400))
	await openEnvironment(page, backend)
	const section = panel(page).getByRole("region", { name: "Repositories" })
	await section.getByLabel("GitHub repository URL").fill("https://github.com/acme/toolkit")
	await section.getByRole("textbox", { name: "Deploy key", exact: true }).fill("-----BEGIN OPENSSH PRIVATE KEY----- abc -----END OPENSSH PRIVATE KEY-----")
	await expect(section.getByRole("textbox", { name: "Deploy key", exact: true })).toHaveAttribute("type", "password")
	await section.getByRole("button", { name: "Add", exact: true }).click()
	const prompt = page.getByRole("dialog", { name: "Save deploy key" })
	await expect(prompt.getByLabel("Confirm password")).toHaveCount(0)
	await prompt.getByLabel("Encryption password").fill("wrong")
	await prompt.getByRole("button", { name: "Add repository" }).click()
	await expect(prompt.getByRole("alert")).toHaveText("The repository was not added.")
	await expect(alert(page, "Repository failed")).toContainText("Invalid encrypted secret or password")
	backend.handlers.set("POST /credentials/environment/repositories", response => {
		current = environment({ requires_password: true, repositories: [toolkit(false)] })
		json(response, { repository: toolkit(false), suggestions: [] })
	})
	await prompt.getByLabel("Encryption password").fill("right")
	await prompt.getByRole("button", { name: "Add repository" }).click()
	await expect(prompt).toHaveCount(0)
	await expect(page.getByRole("status").filter({ hasText: "Repositories" })).toContainText("Repository added. Available after restart.")
	await expect(section).toContainText("https://github.com/acme/toolkit · deploy key")
	await expect(section).toContainText("Available on next start")
	await expect(section.getByLabel("GitHub repository URL")).toHaveValue("")
	expect(repositoryRequests(backend).map(request => request.body)).toEqual([
		{ url: "https://github.com/acme/toolkit", deploy_key: "-----BEGIN OPENSSH PRIVATE KEY----- abc -----END OPENSSH PRIVATE KEY-----", password: "wrong" },
		{ url: "https://github.com/acme/toolkit", deploy_key: "-----BEGIN OPENSSH PRIVATE KEY----- abc -----END OPENSSH PRIVATE KEY-----", password: "right" },
	])
})

test("a public repository is added without a password, then updated and removed", async ({ desktop: { page }, backend }) => {
	let current = environment()
	backend.handlers.set("GET /credentials/environment", response => json(response, current))
	backend.handlers.set("POST /credentials/environment/repositories", response => {
		current = environment({ repositories: [toolkit(true)] })
		json(response, { repository: toolkit(true), suggestions: [] })
	})
	await openEnvironment(page, backend)
	const section = panel(page).getByRole("region", { name: "Repositories" })
	await section.getByLabel("GitHub repository URL").fill("https://github.com/acme/toolkit")
	await section.getByRole("button", { name: "Add", exact: true }).click()
	await expect(section.getByText("alpha tool", { exact: true })).toBeVisible()
	await expect(page.getByRole("dialog")).toHaveCount(0)
	backend.handlers.set("POST /credentials/environment/repositories/toolkit/update", response => {
		current = environment({ repositories: [toolkit(false, "gamma_tool")] })
		json(response, { repository: toolkit(false, "gamma_tool"), suggestions: [] })
	})
	await section.getByRole("button", { name: "Update toolkit" }).click()
	await expect(page.getByRole("status").filter({ hasText: "Updated toolkit" })).toBeVisible()
	await expect(section.getByText("gamma tool", { exact: true })).toBeVisible()
	await expect(toast(page, "Restart required")).toContainText("Restart to apply your changes.")
	backend.handlers.set("DELETE /credentials/environment/repositories/toolkit", response => {
		current = environment()
		json(response, { status: "removed" })
	})
	await section.getByRole("button", { name: "Remove toolkit" }).click()
	await section.getByRole("button", { name: "Confirm removing toolkit" }).click()
	await expect(page.getByRole("status").filter({ hasText: "Removed toolkit" })).toBeVisible()
	await expect(section.getByText("gamma tool", { exact: true })).toHaveCount(0)
	expect(repositoryRequests(backend).map(request => `${request.method} ${request.path}`)).toEqual([
		"POST /credentials/environment/repositories",
		"POST /credentials/environment/repositories/toolkit/update",
		"DELETE /credentials/environment/repositories/toolkit",
	])
	expect(repositoryRequests(backend)[0].body).toEqual({ url: "https://github.com/acme/toolkit" })
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
	const confirm = toast(page, "Unsaved changes")
	await expect(confirm).toContainText("Restart without saving your environment changes? Unsaved changes will be lost.")
	await confirm.getByRole("button", { name: "Keep editing" }).click()
	expect(await relaunches()).toBe(0)
	await panel(page).getByRole("button", { name: "Restart app" }).click()
	await confirm.getByRole("button", { name: "Restart", exact: true }).click()
	await expect.poll(relaunches).toBe(1)
	await expect(panel(page).getByRole("button", { name: "Restarting…" })).toBeDisabled()
	// The loading screen stays until the app exits; this stub never does.
	await expect(page.locator(".startup[data-stage='loading']")).toBeVisible()
})
