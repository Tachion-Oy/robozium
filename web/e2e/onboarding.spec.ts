import { expect, test } from "./fixtures"

test("a live start without API key files locks the HUD and guides setup", async ({ page }) => {
	await page.route("**/api/credentials", (route) => route.fulfill({
		status: 200,
		contentType: "application/json",
		body: JSON.stringify({ available: false, locked: false, removable: false, setup_required: true }),
	}))
	await page.goto("/?from=app")

	const startHere = page.getByRole("button", { name: "Start Here", exact: true })
	await expect(startHere).toBeVisible()
	await expect(page.getByRole("button", { name: "New Project", exact: true })).toHaveCount(0)
	await expect(page.getByRole("button", { name: "Toggle color theme" })).toBeDisabled()
	await expect(page.locator(".agent-hud__model-trigger").first()).toBeDisabled()

	const view = page.locator(".agent-hud__view-trigger")
	await view.click()
	const options = page.getByRole("listbox", { name: "HUD view" }).getByRole("option")
	await expect(options).toHaveCount(3)
	await expect(options.filter({ hasText: "Runs Overview" })).toBeDisabled()
	await expect(options.filter({ hasText: "Dependencies" })).toBeDisabled()
	await expect(options.filter({ hasText: "Environment" })).toBeEnabled()
	await page.getByRole("option", { name: "Environment" }).click()
	await expect(page.getByRole("region", { name: "Environment settings" })).toBeVisible()
	await view.click()
	await page.getByRole("option", { name: "Runs Overview" }).click()

	await startHere.click()
	await expect(page.getByRole("heading", { name: "Welcome to Robozium" })).toBeVisible()
	await expect(page.getByRole("textbox", { name: "Reply text" })).toBeDisabled()
	for (const name of ["Send", "Record", "Cancel", "Interrupt"]) {
		await expect(page.getByRole("button", { name, exact: true })).toBeDisabled()
	}

	const next = page.getByRole("button", { name: "Next agent message" })
	for (const heading of [
		"1. Get an API key",
		"2. Add it in Environment",
		"3. Encrypt and save",
		"4. Start your first run",
	]) {
		await next.click()
		await expect(page.getByRole("heading", { name: heading })).toBeVisible()
	}
	await expect(next).toBeDisabled()

	await page.getByRole("button", { name: "Jump to first agent message" }).click()
	await page.getByRole("button", { name: "Previous agent message" }).click()
	await expect(startHere).toBeVisible()
})
