import { expect, type Page } from "@playwright/test"
import { test, json, view } from "./run-fixture"
import type { Backend } from "./selection-fixture"
import { toast } from "./native"

const environment = (overrides: Record<string, unknown> = {}) => ({
	revision: "r1", entries: [] as unknown[], overrides: [], requires_password: false, editable: true,
	suggestions: [], example_errors: [], imports: [], ...overrides,
})
const saved = { name: "OPENROUTER_API_KEY", value: null, secret: true, configured: true, overridden: false, startup: false }
const keyFile = (page: Page) => page.getByRole("group", { name: "Key file" })
const prompt = (page: Page) => page.getByRole("dialog")
const uploads = (backend: Backend) => backend.requests.filter(request => request.path === "/credentials/environment/file")
const restartNotice = (page: Page) => toast(page, "Restart required")
const content = "OPENROUTER_API_KEY_ENCRYPTED=roboz-encrypted:synthetic\n"

async function openEnvironment(page: Page, backend: Backend) {
	await backend.open()
	await view(page, "Environment")
	await expect(page.getByRole("region", { name: "Environment settings" })).toBeVisible()
	// The chooser accepts a file only once settings have loaded, as Browse shows.
	await expect(keyFile(page).getByRole("button", { name: "Browse file" })).toBeEnabled()
}

test("a dropped key file with its password loads the keys at once; a wrong password stays in place", async ({ desktop: { page }, backend }) => {
	let current = environment()
	let credentialReads = 0
	backend.handlers.set("GET /credentials/environment", response => json(response, current))
	backend.handlers.set("GET /credentials", response => {
		credentialReads++
		json(response, { available: credentialReads > 1, locked: false, removable: credentialReads > 1, setup_required: false })
	})
	let attempts = 0
	backend.handlers.set("POST /credentials/environment/file", response => {
		if (++attempts === 1) return json(response, { detail: "Invalid encrypted secret or password" }, 400)
		current = environment({ revision: "r2", requires_password: true, entries: [saved] })
		json(response, { status: "replaced", loaded: true })
	})
	await openEnvironment(page, backend)
	await expect(prompt(page)).toHaveCount(0)
	await keyFile(page).evaluate((form, text) => {
		const data = new DataTransfer()
		data.items.add(new File([text], ".env.encrypt"))
		form.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }))
	}, content)
	await expect(keyFile(page).getByLabel("Selected key file")).toHaveValue(".env.encrypt")
	// The file needs its password before it can be sent: a modal prompt takes focus.
	await expect(prompt(page)).toHaveAccessibleName("Use key file")
	await expect(prompt(page)).toContainText("Enter the password .env.encrypt was encrypted with.")
	await expect(prompt(page).getByLabel("Key file password")).toBeFocused()
	await expect(prompt(page).getByRole("button", { name: "Use key file" })).toBeDisabled()
	await prompt(page).getByLabel("Key file password").fill("wrong")
	await prompt(page).getByRole("button", { name: "Use key file" }).click()
	await expect(prompt(page).getByRole("alert")).toHaveText("Invalid encrypted secret or password")
	await expect(keyFile(page).getByLabel("Selected key file")).toHaveValue(".env.encrypt")

	await prompt(page).getByLabel("Key file password").fill("right")
	await prompt(page).getByRole("button", { name: "Use key file" }).click()
	await expect(prompt(page)).toHaveCount(0)
	await expect(page.getByRole("status").filter({ hasText: "Keys loaded" })).toContainText("Your key file is in use.")
	await expect(keyFile(page).getByLabel("Selected key file")).toHaveValue("")
	await expect(page.getByLabel("Current value for OPENROUTER_API_KEY")).toHaveText("●●●●●●●●")
	await expect(restartNotice(page)).toHaveCount(0)
	// The header learns that secrets are now available.
	await expect.poll(() => credentialReads).toBeGreaterThan(1)

	const body = String(uploads(backend)[1].body)
	expect(body).toContain('filename=".env.encrypt"')
	expect(body).toContain(content)
	expect(body).toMatch(/name="revision"\r\n\r\nr1\r\n/)
	expect(body).toMatch(/name="password"\r\n\r\nright\r\n/)
})

test("a browsed key file replaces saved settings, and applies after a restart outside setup", async ({ desktop: { page }, backend }) => {
	let current = environment({ requires_password: true, entries: [saved] })
	backend.handlers.set("GET /credentials/environment", response => json(response, current))
	backend.handlers.set("POST /credentials/environment/file", response => {
		current = environment({ revision: "r2", requires_password: true, entries: [saved] })
		json(response, { status: "replaced", loaded: false })
	})
	await openEnvironment(page, backend)
	await keyFile(page).getByLabel("Choose key file").setInputFiles({ name: ".env.encrypt", mimeType: "application/octet-stream", buffer: Buffer.from(content) })
	await expect(prompt(page)).toHaveAccessibleName("Replace saved settings")
	await expect(prompt(page)).toContainText("This replaces the saved settings.")
	await prompt(page).getByLabel("Key file password").fill("right")
	await prompt(page).getByRole("button", { name: "Replace saved settings" }).click()
	await expect(page.getByRole("status").filter({ hasText: "Key file saved" })).toContainText("Use Restart app in Environment")
	await expect(restartNotice(page)).toBeVisible()
	expect(uploads(backend)).toHaveLength(1)
})

test("the key file prompt cancels with Escape or Cancel and keeps the rest of the HUD inert", async ({ desktop: { page }, backend }) => {
	backend.handlers.set("GET /credentials/environment", response => json(response, environment()))
	await openEnvironment(page, backend)
	const choose = () => keyFile(page).getByLabel("Choose key file").setInputFiles({ name: ".env.encrypt", mimeType: "application/octet-stream", buffer: Buffer.from(content) })
	await choose()
	await expect(prompt(page).getByLabel("Key file password")).toBeFocused()
	// Tab stays inside the modal prompt.
	for (let step = 0; step < 4; step++) await page.keyboard.press("Tab")
	await expect(prompt(page).locator(":focus")).toHaveCount(1)
	await page.keyboard.press("Escape")
	await expect(prompt(page)).toHaveCount(0)
	await expect(keyFile(page).getByLabel("Selected key file")).toHaveValue("")
	await choose()
	await prompt(page).getByRole("button", { name: "Cancel" }).click()
	await expect(prompt(page)).toHaveCount(0)
	expect(uploads(backend)).toHaveLength(0)
})
