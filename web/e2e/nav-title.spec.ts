import { expect, test } from "@playwright/test"
import fs from "node:fs"
import path from "node:path"
import { gotoLanding } from "./helpers"

const configPath = path.resolve(__dirname, "..", "..", "hub.config.json")
const hubConfig = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
	hub?: { name?: string }
}
const hubBrand = (hubConfig.hub?.name ?? "robosprawl").toUpperCase()

test.use({ viewport: { width: 1920, height: 1080 } })

test("shows the large centered title and reserves the landing nav row", async ({ page }) => {
	await gotoLanding(page)

	const title = page.locator(".app-nav__brand--bar")
	await expect(title).toBeVisible()
	await expect(title).toHaveText(hubBrand)
	await expect
		.poll(async () => {
			const bounds = await title.boundingBox()
			return bounds
				? Math.abs(bounds.x + bounds.width / 2 - 960)
				: Number.POSITIVE_INFINITY
		})
		.toBeLessThan(1)
	const titleBounds = await title.boundingBox()
	expect(titleBounds).not.toBeNull()
	if (!titleBounds) throw new Error("Landing title has no layout bounds")
	expect(titleBounds.y).toBeGreaterThanOrEqual(0)
	expect(titleBounds.height).toBeLessThan(80)

	const frameBounds = await page.locator(".term-frame").evaluate((element) => {
		const bounds = element.getBoundingClientRect()
		return { y: bounds.y, height: bounds.height }
	})
	expect(Math.abs(frameBounds.y - 1080 * 0.08)).toBeLessThan(1)
	expect(Math.abs(frameBounds.height - 1080 * 0.92)).toBeLessThan(1)
})
