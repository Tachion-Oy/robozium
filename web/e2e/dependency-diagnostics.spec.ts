import { expect, test } from "./fixtures"
import { gotoLanding, selectHudView } from "./helpers"
import { waitForHudLayout } from "./hud-layout"
import type { DependencyRecord } from "../lib/robozium/wire"

test("keeps dependency metadata and diagnostics inside their cells in both themes", async ({ page }) => {
	test.setTimeout(60_000)
	const dependencies: DependencyRecord[] = [{
		dependency_id: "executable:libreoffice",
		kind: "executable",
		redacted_metadata: { display_name: "libreoffice", executable: "libreoffice" },
		status: "available",
		checked_at: "2026-10-11T19:17:27Z",
		latency_ms: 1,
		reason_code: null,
		message: null,
	}, {
		dependency_id: `network:${"long-service-identifier".repeat(8)}`,
		kind: "network_service",
		redacted_metadata: {
			[`configuration_${"location".repeat(8)}`]: `/applications/${"directory".repeat(20)}`,
		},
		status: "unavailable",
		checked_at: "2026-10-11T19:17:27Z",
		latency_ms: null,
		reason_code: "authentication_failed",
		message: `Unable to reach https://example.invalid/${"endpoint".repeat(40)}\nCheck the configured service address.`,
	}]
	await page.route("**/api/admin/dependencies", (route) => route.fulfill({ json: dependencies }))
	await gotoLanding(page)
	await selectHudView(page, "Dependencies")
	await expect(page.getByText("libreoffice", { exact: true })).toHaveCount(2)
	for (const theme of ["dark", "light"] as const) {
		await page.evaluate((theme) => { document.documentElement.dataset.theme = theme }, theme)
		for (const width of [1280, 640]) {
			await page.setViewportSize({ width, height: 900 })
			await waitForHudLayout(page, [".agent-hud__table-scroll"])
			const geometry = await page.locator(".agent-hud__table-scroll").evaluate((scroller) => {
				const table = scroller.querySelector("table")!
				const cells = Array.from(table.querySelectorAll("th, td"))
				const metadata = Array.from(table.querySelectorAll("dl"))
				const metadataContained = metadata.every((element) => {
					const cell = element.closest("td")!.getBoundingClientRect()
					const range = document.createRange()
					range.selectNodeContents(element)
					return Array.from(range.getClientRects()).every((rect) =>
						rect.left >= cell.left - 1 && rect.right <= cell.right + 1,
					)
				})
				const context = document.createElement("canvas").getContext("2d")!
				const style = getComputedStyle(cells[0])
				context.font = `${style.fontSize} ${style.fontFamily}`
				return {
					clientWidth: scroller.clientWidth,
					scrollWidth: scroller.scrollWidth,
					minimumWidth: Math.min(...cells.map((cell) => cell.getBoundingClientRect().width)),
					tenCharacters: context.measureText("0000000000").width,
					cellOverflow: Math.max(...cells.map((cell) => cell.scrollWidth - cell.clientWidth)),
					metadataContained,
				}
			})
			expect(geometry.metadataContained).toBe(true)
			expect(geometry.cellOverflow).toBeLessThanOrEqual(1)
			expect(geometry.minimumWidth).toBeGreaterThanOrEqual(geometry.tenCharacters - 1)
			if (width === 1280) {
				expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1)
			} else {
				expect(geometry.scrollWidth).toBeGreaterThan(geometry.clientWidth)
			}
		}
	}
})

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
