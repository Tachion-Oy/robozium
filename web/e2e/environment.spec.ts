import fs from "node:fs/promises"
import path from "node:path"
import { expect, test } from "./fixtures"
import { gotoLanding, selectHudView } from "./helpers"
import { waitForHudLayout } from "./hud-layout"

test("environment saves masked secrets, replaces and removes them, and requires a manual restart", async ({ page, request }) => {
	await page.goto("/?from=app")
	await page.getByRole("button", { name: "Runs Overview", exact: true }).click()
	await page.getByRole("option", { name: "Environment", exact: true }).click()
	await expect(page.getByRole("button", { name: "Add variable" })).toBeEnabled()
	await expect(page.getByText("[required]", { exact: true })).toHaveCount(5)
	await expect(page.getByLabel("Current value for ROBOZIUM_WEB_PORT")).toHaveText("6969")
	await page.getByRole("button", { name: "Change OPENROUTER_API_KEY", exact: true }).click()
	await page.getByLabel("Value for OPENROUTER_API_KEY", { exact: true }).fill("dummy-environment-key")
	await page.getByRole("button", { name: "Apply", exact: true }).click()
	await page.getByLabel("Encryption password", { exact: true }).fill("dummy-password")
	await page.getByLabel("Confirm encryption password").fill("dummy-password")
	const savedToast = page.locator(".agent-error-toast--success.agent-error-toast--visible").filter({ hasText: "Settings saved" })
	try {
		await page.getByRole("button", { name: "Encrypt and save" }).click()
		await expect(savedToast).toContainText("./start")
		await expect(savedToast).toContainText("unlock with Secrets")
		await expect(page.getByRole("region", { name: "Environment settings" }).getByText(/Settings saved|Restart using/)).toHaveCount(0)
		await savedToast.getByRole("button", { name: "Dismiss success notification" }).click()
		await expect(savedToast).toHaveCount(0)
		await expect(page.getByLabel("Encryption password", { exact: true })).toBeDisabled()
		const response = await request.get("/api/credentials/environment")
		expect(await response.text()).not.toContain("dummy-environment-key")
		expect((await response.json()).entries).toContainEqual(expect.objectContaining({ name: "OPENROUTER_API_KEY", value: null, secret: true }))
		await page.getByRole("button", { name: "Change OPENROUTER_API_KEY", exact: true }).click()
		await expect(page.getByLabel("Value for OPENROUTER_API_KEY", { exact: true })).toHaveValue("")
		await page.getByLabel("Value for OPENROUTER_API_KEY", { exact: true }).fill("replacement-dummy-key")
		await page.getByRole("button", { name: "Apply", exact: true }).click()
		await page.getByLabel("Encryption password", { exact: true }).fill("wrong-password")
		await page.getByRole("button", { name: "Encrypt and save" }).click()
		await expect(page.getByText("Invalid encrypted secret or password", { exact: true })).toBeVisible()
		await expect(page.getByRole("region", { name: "Environment settings" }).getByText("Invalid encrypted secret or password", { exact: true })).toHaveCount(0)
		await page.getByRole("button", { name: "Dismiss error notification", exact: true }).click()
		await expect(page.getByText("Invalid encrypted secret or password", { exact: true })).toBeHidden()
		await page.getByLabel("Encryption password", { exact: true }).fill("dummy-password")
		await page.getByRole("button", { name: "Encrypt and save" }).click()
		await expect(savedToast).toBeVisible()
		await savedToast.getByRole("button", { name: "Dismiss success notification" }).click()
		await expect(savedToast).toHaveCount(0)
		await page.getByRole("button", { name: "Change OPENROUTER_API_KEY", exact: true }).click()
		await page.getByRole("button", { name: "Delete OPENROUTER_API_KEY" }).click()
		await expect(page.getByRole("button", { name: "Change OPENROUTER_API_KEY", exact: true })).toHaveCount(0)
		await page.getByLabel("Encryption password", { exact: true }).fill("dummy-password")
		await page.getByRole("button", { name: "Encrypt and save" }).click()
		await expect(savedToast).toBeVisible()
		const entries = (await (await request.get("/api/credentials/environment")).json()).entries
		expect(entries.map((entry: { name: string; value: string; secret: boolean }) => [entry.name, entry.value, entry.secret]).sort()).toEqual([
			["ROBOZIUM_HUB_ROOT", "../Robozium-Hub", false],
			["ROBOZIUM_WEB_PORT", "6969", false],
		])
	} finally {
		const state = await (await request.get("/api/credentials/environment")).json()
		expect((await request.post("/api/credentials/environment", { data: { revision: state.revision, entries: [], password: "dummy-password" } })).ok()).toBeTruthy()
	}
})

test("forgotten passwords can be reset only after confirmation", async ({ page, request }) => {
	const initial = await (await request.get("/api/credentials/environment")).json()
	expect((await request.post("/api/credentials/environment", { data: {
		revision: initial.revision, password: "forgotten-password", entries: [
			{ name: "FORGOTTEN_TOKEN", value: "old-secret", secret: true },
		],
	} })).ok()).toBeTruthy()
	try {
		await gotoLanding(page)
		await selectHudView(page, "Environment")
		await page.getByRole("button", { name: "Reset environment", exact: true }).click()
		await expect(page.getByText("Are you sure? This permanently deletes all saved settings and secrets.")).toBeVisible()
		await page.getByRole("button", { name: "Keep settings", exact: true }).click()
		const retained = await (await request.get("/api/credentials/environment")).json()
		expect(retained.entries).toContainEqual(expect.objectContaining({ name: "FORGOTTEN_TOKEN" }))
		await page.getByRole("button", { name: "Reset environment", exact: true }).click()
		await page.getByRole("button", { name: "Yes, reset", exact: true }).click()
		await expect(page.getByText("Environment reset", { exact: true })).toBeVisible()
		await expect(page.getByLabel("Current value for FORGOTTEN_TOKEN")).toHaveCount(0)
		const cleared = await (await request.get("/api/credentials/environment")).json()
		expect(cleared.entries).toEqual([])
		expect(cleared.requires_password).toBe(false)
		await expect(page.getByLabel("Encryption password", { exact: true })).toHaveCount(0)
		await page.getByRole("button", { name: "Change OPENROUTER_API_KEY", exact: true }).click()
		await page.getByLabel("Value for OPENROUTER_API_KEY", { exact: true }).fill("new-secret")
		await page.getByLabel("Encryption password", { exact: true }).fill("new-password")
		await page.getByLabel("Confirm encryption password").fill("new-password")
		await page.getByRole("button", { name: "Encrypt and save", exact: true }).click()
		await expect(page.getByText("Settings saved", { exact: true })).toBeVisible()
		await expect(page.getByLabel("Encryption password", { exact: true })).toBeDisabled()
	} finally {
		expect((await request.delete("/api/credentials/environment")).ok()).toBeTruthy()
	}
})

test("a queued run disables the Environment view and rejects saving", async ({ page, request }) => {
	await request.post("/api/projects", { data: { name: "environment-busy" } })
	const run = await request.post("/api/runs/create", { data: { project: "environment-busy" } })
	expect(run.ok()).toBeTruthy()
	try {
		await page.goto("/?from=app")
		await page.getByRole("button", { name: "Runs Overview", exact: true }).click()
		await page.getByRole("option", { name: "Environment", exact: true }).click()
		await expect(page.getByText(/Stop all runs and background work/)).toBeVisible()
		await expect(page.getByRole("button", { name: "Add variable" })).toBeDisabled()
		await expect(page.getByRole("button", { name: "Reset environment" })).toBeDisabled()
		const state = await (await request.get("/api/credentials/environment")).json()
		const saved = await request.post("/api/credentials/environment", { data: { revision: state.revision, entries: [] } })
		expect(saved.status()).toBe(409)
	} finally {
		await request.post("/api/projects/environment-busy/cancel")
	}
})

test("folder imports persist tools and suggestions and variable editing works in both themes", async ({ page, request }, testInfo) => {
	const folder = testInfo.outputPath("source_package")
	await fs.mkdir(folder, { recursive: true })
	await fs.writeFile(path.join(folder, "__init__.py"), "from roboz.deployment import Capability, ToolLabel\nfrom roboz.tools import stop\nCAPABILITY = Capability(label=ToolLabel('example_tool', selectable=True), value=stop)\n")
	await fs.writeFile(path.join(folder, "requirements.txt"), "")
	await fs.writeFile(path.join(folder, "env.example"), "IMPORTED_SETTING=example\n")
	await fs.writeFile(path.join(folder, ".env"), "PRIVATE=not-an-example\n")
	const initial = await (await request.get("/api/credentials/environment")).json()
	expect((await request.post("/api/credentials/environment", { data: {
		revision: initial.revision, password: "dummy-password", entries: [
			{ name: "EXAMPLE_CURRENT", value: "current value", secret: false },
			{ name: "EXAMPLE_TOKEN", value: "dummy-key", secret: true },
		],
	} })).ok()).toBeTruthy()
	try {
		await gotoLanding(page)
		await selectHudView(page, "Environment")
		const panel = page.getByRole("region", { name: "Environment settings" })
		await expect(panel.getByLabel("Selected tool or skill folder")).toBeEnabled()
		await expect(panel.getByText("local/", { exact: true })).toHaveCount(0)
		await expect(panel.getByLabel("Current value for OPENROUTER_API_KEY")).toHaveText("Not set")
		await expect(panel.getByLabel("Current value for EXAMPLE_CURRENT")).toHaveText("current value")
		await expect(panel.getByLabel("Current value for EXAMPLE_TOKEN")).toHaveText("●●●●●●●●")
		const folderInput = panel.getByLabel("Selected tool or skill folder")
		await panel.getByLabel("Choose tool or skill folder").setInputFiles(folder)
		await expect(page.getByText("Tool example_tool found and imported. Available after restart.", { exact: true })).toBeVisible()
		await expect(panel.getByRole("button", { name: "Change IMPORTED_SETTING" })).toBeVisible()
		await expect(panel.getByRole("region", { name: "Tools & skills" }).getByText("example tool", { exact: true })).toBeVisible()
		await expect(folderInput).toHaveValue("")
		await expect(panel.getByLabel("Current value for IMPORTED_SETTING")).toHaveText("example")
		await expect(panel.getByRole("button", { name: "Encrypt and save", exact: true })).toBeEnabled()
		await page.reload()
		await selectHudView(page, "Environment")
		await expect(panel.getByRole("button", { name: "Change IMPORTED_SETTING" })).toHaveCount(1)
		await expect(panel.getByRole("region", { name: "Tools & skills" }).getByText("example tool", { exact: true })).toHaveCount(1)
		await expect(panel.getByRole("button", { name: "Change PRIVATE" })).toHaveCount(0)

		for (const theme of ["dark", "light"]) {
			await page.evaluate(value => document.documentElement.setAttribute("data-theme", value), theme)
			await page.setViewportSize({ width: 1440, height: 1000 })
			await waitForHudLayout(page)
			await page.screenshot({ path: testInfo.outputPath(`environment-${theme}-list.png`), animations: "disabled" })
			await panel.getByRole("button", { name: "Change OPENROUTER_API_KEY", exact: true }).click()
			const editor = panel.getByRole("form", { name: "Variable editor" })
			await expect(editor.getByRole("checkbox", { name: "Secret" })).toBeChecked()
			await editor.getByRole("checkbox", { name: "Secret" }).press("Space")
			await expect(editor.getByRole("checkbox", { name: "Secret" })).not.toBeChecked()
			await editor.getByRole("checkbox", { name: "Secret" }).press("Enter")
			await expect(editor.getByRole("checkbox", { name: "Secret" })).toBeChecked()
			for (const width of [1440, 800]) {
				await page.setViewportSize({ width, height: 1000 })
				await waitForHudLayout(page)
				const bounds = await panel.boundingBox()
				const secret = await editor.getByRole("checkbox", { name: "Secret" }).boundingBox()
				const apply = await editor.getByRole("button", { name: "Apply", exact: true }).boundingBox()
				const cancel = await editor.getByRole("button", { name: "Cancel", exact: true }).boundingBox()
				expect(Math.abs(secret!.height - apply!.height)).toBeLessThanOrEqual(1)
				expect(Math.abs(secret!.height - cancel!.height)).toBeLessThanOrEqual(1)
				expect(cancel!.x).toBeGreaterThanOrEqual(bounds!.x)
				expect(cancel!.x + cancel!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width)
				expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
				await page.screenshot({ path: testInfo.outputPath(`environment-${theme}-${width}.png`), animations: "disabled" })
			}
			await editor.getByLabel("Name", { exact: true }).press("Escape")
			await expect(editor).toHaveCount(0)
			await expect(panel.getByRole("button", { name: "Change OPENROUTER_API_KEY" })).toBeVisible()
			await expect(panel.getByRole("button", { name: "Encrypt and save", exact: true })).toBeEnabled()
		}

		const imports = panel.getByRole("region", { name: "Tools & skills" })
		await imports.getByRole("button", { name: "Remove source_package" }).click()
		await imports.getByRole("button", { name: "Confirm removing source_package" }).click()
		await expect(page.getByText("Removed source_package. Takes effect after restart.", { exact: true })).toBeVisible()
		await expect(imports.getByText("No imports yet.")).toBeVisible()
		await expect(panel.getByRole("button", { name: "Change IMPORTED_SETTING" })).toHaveCount(0)
		await panel.getByLabel("Choose tool or skill folder").setInputFiles(folder)
		await expect(imports.getByText("example tool", { exact: true })).toBeVisible()
	} finally {
		await fs.rm(path.join(process.env.ROBOZIUM_E2E_CONTROL_DIR!, "local/imports/source_package"), { recursive: true, force: true })
		const state = await (await request.get("/api/credentials/environment")).json()
		expect((await request.post("/api/credentials/environment", { data: { revision: state.revision, entries: [], password: "dummy-password" } })).ok()).toBeTruthy()
	}
})
