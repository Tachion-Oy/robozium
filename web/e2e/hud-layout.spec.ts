import { expect, test } from "./fixtures"
import { gotoLanding } from "./helpers"
import { waitForHudLayout } from "./hud-layout"

test.use({ viewport: { width: 1280, height: 900 } })

test("layout readiness waits for a delayed viewport update", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" })
	await page.addInitScript(() => {
		const viewport = Object.assign(new EventTarget(), {
			height: innerHeight, width: innerWidth, offsetTop: 0, offsetLeft: 0, scale: 1,
		})
		Object.defineProperty(window, "visualViewport", { value: viewport })
	})
	await gotoLanding(page)
	// Hold the browser's visible-viewport event independently of layout resize.
	await page.evaluate(() => {
		const viewport = window.visualViewport!
		Object.assign(viewport, { width: 600 })
		setTimeout(() => viewport.dispatchEvent(new Event("resize")), 700)
	})
	await waitForHudLayout(page)
	const title = await page.locator(".app-nav__brand--bar").boundingBox()
	expect(title).not.toBeNull()
	expect(title!.x + title!.width / 2).toBeCloseTo(300, 0)
})

for (const property of ["height", "color"] as const) {
	test(`layout readiness waits for a delayed ${property} transition`, async ({ page }) => {
		await gotoLanding(page)
		await page.evaluate((property) => {
			const target = property === "height"
				? document.querySelector<HTMLElement>(".agent-hud__box")!
				: document.querySelector<HTMLElement>(".agent-hud__view-trigger")!
			target.style.transition = `${property} 100ms linear 700ms`
			// The long delay leaves several identical samples before motion starts.
			target.style[property] = property === "height" ? "520px" : "rgb(1, 2, 3)"
		}, property)
		await waitForHudLayout(page)
		if (property === "height") {
			const bounds = await page.locator(".agent-hud__box").boundingBox()
			expect(bounds!.height).toBeCloseTo(520, 0)
		} else {
			const color = await page.locator(".agent-hud__view-trigger").evaluate((element) => getComputedStyle(element).color)
			expect(color).toBe("rgb(1, 2, 3)")
		}
	})
}
