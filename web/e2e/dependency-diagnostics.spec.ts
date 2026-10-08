import { expect, test } from "./fixtures"
import { gotoLanding } from "./helpers"
import type { DependencyRecord } from "../lib/robozium/wire"

test("shows and copies a dependency cause and clears it on recovery", async ({ page }) => {
	const failure: DependencyRecord = {
		dependency_id: "network:diagnostic-test",
		kind: "network_service",
		redacted_metadata: { host: "bridge.invalid" },
		status: "unavailable",
		checked_at: "2026-10-08T19:00:00Z",
		latency_ms: 1,
		reason_code: "connection_failed",
		message: "Unable to communicate with Bridge\nCaused by: gaierror: [Errno -2] Name or service not known",
	}
	await page.route("**/api/admin/dependencies", async (route) => {
		await route.fulfill({ json: [route.request().method() === "POST"
			? { ...failure, status: "available", reason_code: null, message: null }
			: failure] })
	})
	await page.addInitScript(() => {
		Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
			writeText: async (text: string) => { sessionStorage.setItem("copied-diagnostic", text) },
		} })
	})
	await gotoLanding(page)
	await page.getByRole("button", { name: "Runs Overview", exact: true }).click()
	await page.getByRole("option", { name: "Dependencies", exact: true }).click()
	await expect(page.getByText(/Caused by: gaierror/)).toBeVisible()
	await page.getByRole("button", { name: "Copy diagnostic", exact: true }).click()
	await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible()
	expect(await page.evaluate(() => sessionStorage.getItem("copied-diagnostic"))).toContain(failure.message)
	await page.getByRole("button", { name: "Check Now", exact: true }).click()
	await expect(page.getByText("AVAILABLE", { exact: true })).toBeVisible()
	await expect(page.getByText(/Caused by: gaierror/)).toHaveCount(0)
})
