import { expect, type Page } from "@playwright/test"
import { test, json, view } from "./run-fixture"
import type { Backend } from "./selection-fixture"

const environment = (overrides: Record<string, unknown> = {}) => ({
	revision: "r1", entries: [] as unknown[], overrides: [], requires_password: false, editable: true,
	suggestions: [], example_errors: [], imports: [], ...overrides,
})
const saved = { name: "OPENROUTER_API_KEY", value: null, secret: true, configured: true, overridden: false, startup: false }
const keyFile = (page: Page) => page.getByRole("form", { name: "Use key file" })
const uploads = (backend: Backend) => backend.requests.filter(request => request.path === "/credentials/environment/file")
const restartNotice = (page: Page) => page.getByRole("status").filter({ hasText: "Restart to apply your changes." })
const content = "OPENROUTER_API_KEY_ENCRYPTED=roboz-encrypted:synthetic\n"

async function openEnvironment(page: Page, backend: Backend) {
	await backend.open()
	await view(page, "Environment")
	await expect(page.getByRole("region", { name: "Environment settings" })).toBeVisible()
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
	await expect(keyFile(page).getByLabel("Key file password")).toHaveCount(0)
	await keyFile(page).evaluate((form, text) => {
		const data = new DataTransfer()
		data.items.add(new File([text], ".env.encrypt"))
		form.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }))
	}, content)
	await expect(keyFile(page).getByLabel("Selected key file")).toHaveValue(".env.encrypt")
	await keyFile(page).getByLabel("Key file password").fill("wrong")
	await keyFile(page).getByRole("button", { name: "Use key file" }).click()
	await expect(keyFile(page).getByRole("alert")).toHaveText("API request failed (400): Invalid encrypted secret or password")
	await expect(keyFile(page).getByLabel("Selected key file")).toHaveValue(".env.encrypt")

	await keyFile(page).getByLabel("Key file password").fill("right")
	await keyFile(page).getByRole("button", { name: "Use key file" }).click()
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
	await expect(keyFile(page)).toContainText("This replaces the saved settings below.")
	await keyFile(page).getByLabel("Key file password").fill("right")
	await keyFile(page).getByRole("button", { name: "Replace saved settings" }).click()
	await expect(page.getByRole("status").filter({ hasText: "Key file saved" })).toContainText("Use Restart app in Environment")
	await expect(restartNotice(page)).toBeVisible()
	expect(uploads(backend)).toHaveLength(1)
})
