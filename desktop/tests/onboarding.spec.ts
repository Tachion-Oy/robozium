import { expect, type Page } from "@playwright/test"
import { viewTrigger } from "./native"
import { test, json, view, launchButton } from "./run-fixture"
import type { Backend } from "./selection-fixture"

const status = (setupRequired: boolean) => ({ available: !setupRequired, locked: false, removable: !setupRequired, setup_required: setupRequired })
const environment = { revision: "r1", entries: [], overrides: [], requires_password: false, editable: true, suggestions: [], example_errors: [], imports: [] }
const startHere = (page: Page) => page.getByRole("button", { name: "Start Here", exact: true })
const newProject = (page: Page) => page.getByRole("button", { name: "New Project", exact: true })
const guide = (page: Page) => page.locator(".agent-hud__replyBox--agent")
const modelSelector = (page: Page) => page.getByRole("button", { name: "First model", exact: true })
const arrow = (page: Page, name: string) => page.getByRole("button", { name, exact: true })

/** A live backend started without keys; `ready` ends setup once keys load. */
function setUp(backend: Backend) {
	const state = { ready: false }
	backend.handlers.set("GET /credentials", response => json(response, status(!state.ready)))
	backend.handlers.set("GET /credentials/environment", response => json(response, environment))
	return state
}

test("a live start without keys locks the HUD on Start Here and the guide pages with the message arrows", async ({ desktop: { page }, backend }) => {
	setUp(backend)
	await backend.open({ awaitOverview: false })
	await expect(startHere(page)).toBeVisible()
	await expect(newProject(page)).toHaveCount(0)
	await expect(launchButton(page, "existing-project")).toBeDisabled()
	await expect(modelSelector(page)).toBeDisabled()
	// The theme is a display preference, so setup leaves it available.
	const html = page.locator("html")
	const theme = await html.getAttribute("data-theme")
	await page.getByRole("button", { name: "Toggle color theme" }).click()
	await expect(html).not.toHaveAttribute("data-theme", theme ?? "")
	await page.getByRole("button", { name: "Toggle color theme" }).click()
	await expect(html).toHaveAttribute("data-theme", theme ?? "")
	await viewTrigger(page).click()
	const menu = page.getByRole("listbox", { name: "HUD view" })
	await expect(menu.getByRole("option", { name: "Dependencies", exact: true })).toBeDisabled()
	await expect(menu.getByRole("option", { name: "Environment", exact: true })).toBeEnabled()
	await page.keyboard.press("Escape")

	await startHere(page).click()
	await expect(guide(page)).toContainText("Welcome to Robozium")
	await expect(guide(page).getByRole("img", { name: "A key next to the Robozium window" })).toBeVisible()
	await arrow(page, "Next agent message").click()
	await expect(guide(page)).toContainText("Already have your keys?")
	await expect(page.locator(".agent-hud__send")).toBeDisabled()
	await expect(page.locator(".agent-hud__dictate")).toBeDisabled()
	await arrow(page, "Jump to latest agent message").click()
	await expect(guide(page)).toContainText("Start your first run")
	await arrow(page, "Jump to first agent message").click()
	// Going back from the first page returns to Runs Overview.
	await arrow(page, "Previous agent message").click()
	await expect(startHere(page)).toBeVisible()
})

test("a dropped key file during setup unlocks the HUD without a restart", async ({ desktop: { page }, backend }) => {
	const state = setUp(backend)
	backend.handlers.set("POST /credentials/environment/file", response => {
		state.ready = true
		json(response, { status: "replaced", loaded: true })
	})
	await backend.open({ awaitOverview: false })
	await expect(startHere(page)).toBeVisible()
	await view(page, "Environment")
	await page.getByRole("group", { name: "Key file" }).getByLabel("Choose key file")
		.setInputFiles({ name: ".env.encrypt", mimeType: "text/plain", buffer: Buffer.from("A_ENCRYPTED=roboz:x\n") })
	const prompt = page.getByRole("dialog", { name: "Use key file" })
	await prompt.getByLabel("Key file password").fill("right")
	await prompt.getByRole("button", { name: "Use key file" }).click()
	// Setup ends: back on Runs Overview, unlocked, with no restart asked for.
	await expect(newProject(page)).toBeVisible()
	await expect(startHere(page)).toHaveCount(0)
	await expect(launchButton(page, "existing-project")).toBeEnabled()
	await expect(modelSelector(page)).toBeEnabled()
})

test("the first save during setup loads the keys and unlocks the HUD", async ({ desktop: { page }, backend }) => {
	const state = setUp(backend)
	backend.handlers.set("POST /credentials/environment", response => {
		state.ready = true
		json(response, { status: "saved" })
	})
	await backend.open({ awaitOverview: false })
	await view(page, "Environment")
	const region = page.getByRole("region", { name: "Environment settings" })
	await region.getByRole("button", { name: "Add variable" }).click()
	const editor = page.getByRole("form", { name: "Variable editor" })
	await editor.getByLabel("Name").fill("OPENROUTER_API_KEY")
	await editor.getByLabel("Value for OPENROUTER_API_KEY").fill("synthetic")
	await editor.getByRole("checkbox", { name: "Secret" }).click()
	await editor.getByRole("button", { name: "Apply" }).click()
	const save = page.getByRole("form", { name: "Save environment settings" })
	await save.getByRole("button", { name: "Encrypt and save" }).click()
	const prompt = page.getByRole("dialog", { name: "Encrypt and save" })
	await prompt.getByLabel("Encryption password").fill("pw")
	await prompt.getByLabel("Confirm password").fill("pw")
	await prompt.getByRole("button", { name: "Encrypt and save" }).click()
	await expect(page.getByRole("status").filter({ hasText: "API keys saved" })).toContainText("Robozium is ready.")
	await expect(newProject(page)).toBeVisible()
	await expect(launchButton(page, "existing-project")).toBeEnabled()
})
