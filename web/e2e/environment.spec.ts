import fs from "node:fs/promises"
import path from "node:path"
import { expect, test } from "./fixtures"

test("mock environment editor encrypts dummy secrets and supports replacement and removal", async ({ page, request }) => {
	const root = process.env.ROBOZIUM_E2E_CONTROL_DIR!
	await page.goto("/?from=app")
	await page.getByRole("button", { name: "Runs Overview", exact: true }).click()
	await page.getByRole("option", { name: "Environment", exact: true }).click()
	await expect(page.getByRole("button", { name: "Add variable" })).toBeEnabled()
	await page.getByRole("button", { name: "Add variable" }).click()
	await page.getByPlaceholder("VARIABLE_NAME").fill("E2E_ODD_NAME")
	await page.getByLabel("Value for E2E_ODD_NAME").fill("dummy-environment-key")
	await page.getByRole("checkbox", { name: "Secret", exact: true }).check()
	await page.getByLabel("Encryption password", { exact: true }).fill("dummy-password")
	await page.getByLabel("Confirm encryption password").fill("dummy-password")
	try {
		await page.getByRole("button", { name: "Encrypt and apply" }).click()
		await expect(page.getByRole("status")).toContainText("Settings saved")
		const encrypted = await fs.readFile(path.join(root, ".env.encrypt"), "utf8")
		expect(encrypted).toContain("E2E_ODD_NAME_ENCRYPTED=")
		expect(encrypted).not.toContain("dummy-environment-key")
		await expect(fs.stat(path.join(root, ".env"))).rejects.toMatchObject({ code: "ENOENT" })
		await page.getByRole("button", { name: "Secrets locked", exact: true }).click()
		await page.getByLabel("Secret password", { exact: true }).fill("dummy-password")
		await page.getByRole("button", { name: "Unlock", exact: true }).click()
		await expect(page.getByRole("button", { name: "Secrets unlocked", exact: true })).toBeVisible()
		await expect(page.getByLabel("Value for E2E_ODD_NAME")).toHaveValue("")
		await page.getByLabel("Value for E2E_ODD_NAME").fill("replacement-dummy-key")
		await page.getByLabel("Encryption password", { exact: true }).fill("dummy-password")
		await page.getByRole("button", { name: "Encrypt and apply" }).click()
		await expect(page.getByRole("status")).toContainText("Settings saved")
		expect(await fs.readFile(path.join(root, ".env.encrypt"), "utf8")).not.toContain("replacement-dummy-key")
		await page.getByRole("button", { name: "Remove E2E_ODD_NAME" }).click()
		await page.getByLabel("Encryption password", { exact: true }).fill("dummy-password")
		await page.getByRole("button", { name: "Encrypt and apply" }).click()
		await expect(page.getByRole("status")).toContainText("Settings saved")
		expect(await fs.readFile(path.join(root, ".env.encrypt"), "utf8")).toBe("")
	} finally {
		await request.post("/api/credentials/clear")
		const state = await (await request.get("/api/admin/environment")).json()
		const response = await request.post("/api/admin/environment", { data: { revision: state.revision, entries: [], password: "dummy-password" } })
		expect(response.ok()).toBeTruthy()
	}
})
