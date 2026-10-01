import { expect, test } from "./fixtures"
import { gotoLanding } from "./helpers"
import nextConfig from "../next.config"

const hubBrand = nextConfig.env!.NEXT_PUBLIC_ROBOZIUM_NAME!.toUpperCase()

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

test("the title clears the stream at a high-zoom viewport", async ({ page }) => {
	await page.setViewportSize({ width: 960, height: 500 })
	await gotoLanding(page)

	const title = page.locator(".app-nav__brand--bar")
	const frame = page.locator(".term-frame")
	const hud = page.locator(".agent-hud__box")
	await expect(title).toBeVisible()
	const titleBounds = await title.boundingBox()
	const frameBounds = await frame.boundingBox()
	const hudBounds = await hud.boundingBox()
	expect(titleBounds).not.toBeNull()
	expect(frameBounds).not.toBeNull()
	expect(hudBounds).not.toBeNull()
	expect(frameBounds!.y - (titleBounds!.y + titleBounds!.height)).toBeGreaterThan(10)
	expect(hudBounds!.y - (titleBounds!.y + titleBounds!.height)).toBeGreaterThan(10)
})

test("keeps the complete title above the expanded HUD in narrow and short viewports", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" })
	await gotoLanding(page)
	const handle = page.getByRole("slider", { name: "Resize HUD" })
	await handle.focus()
	await page.keyboard.press("End")

	for (const viewport of [{ width: 320, height: 568 }, { width: 320, height: 200 }, { width: 200, height: 180 }, { width: 1920, height: 1080 }]) {
		await page.setViewportSize(viewport)
		for (const theme of ["dark", "light"] as const) {
			await page.evaluate((value) => { document.documentElement.dataset.theme = value }, theme)
			await expect.poll(() => page.evaluate(() => {
				const art = document.querySelector(".app-nav__brand .display-art")!.getBoundingClientRect()
				const hud = document.querySelector(".agent-hud__box")!.getBoundingClientRect()
				return art.left >= 0 && art.right <= innerWidth && art.top >= 0 &&
					art.bottom + 10 < hud.top && hud.bottom <= innerHeight + 1
			})).toBe(true)
			const art = await page.locator(".app-nav__brand .display-art").boundingBox()
			expect(art!.width / art!.height).toBeCloseTo(13.97, 1)
		}
	}
})

test("follows visible viewport changes without a layout viewport resize", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" })
	await page.addInitScript(() => {
		const viewport = Object.assign(new EventTarget(), { height: innerHeight, width: innerWidth, offsetTop: 0, offsetLeft: 0, scale: 1 })
		Object.defineProperty(window, "visualViewport", { value: viewport })
	})
	await gotoLanding(page)
	for (const top of [80, 240, 0]) {
		await page.evaluate((offset) => {
			const viewport = window.visualViewport!
			Object.assign(viewport, { height: 400, width: 300, offsetTop: offset, offsetLeft: 100 })
			viewport.dispatchEvent(new Event("resize"))
			viewport.dispatchEvent(new Event("scroll"))
		}, top)
		for (const theme of ["dark", "light"] as const) {
			await page.evaluate((value) => { document.documentElement.dataset.theme = value }, theme)
			await expect.poll(() => page.evaluate(({ top }) => {
				const title = document.querySelector(".app-nav__brand .display-art")!.getBoundingClientRect()
				const hud = document.querySelector(".agent-hud__box")!.getBoundingClientRect()
				return title.left >= 100 && title.right <= 400 &&
					hud.left >= 100 && hud.right <= 400 &&
					title.top >= top && title.bottom + 10 < hud.top && hud.bottom <= top + 401
			}, { top })).toBe(true)
		}
	}
})

test("keeps viewport listeners when the landing navigation unmounts and returns", async ({ page }) => {
	await page.addInitScript(() => {
		const viewport = Object.assign(new EventTarget(), { height: innerHeight, width: innerWidth, offsetTop: 0, offsetLeft: 0, scale: 1 })
		const counts = { resize: 0, scroll: 0, removed: 0 }
		const add = viewport.addEventListener.bind(viewport)
		const remove = viewport.removeEventListener.bind(viewport)
		viewport.addEventListener = (...args: Parameters<typeof add>) => {
			if (args[0] === "resize" || args[0] === "scroll") counts[args[0]]++
			add(...args)
		}
		viewport.removeEventListener = (...args: Parameters<typeof remove>) => {
			if (args[0] === "resize" || args[0] === "scroll") counts.removed++
			remove(...args)
		}
		Object.defineProperty(window, "visualViewport", { value: viewport })
		Object.defineProperty(window, "viewportListenerCounts", { value: counts })
	})
	await gotoLanding(page)
	await page.evaluate(() => history.pushState(null, "", "/?runId=viewport-listener-test"))
	await expect(page.locator(".app-nav__row")).toHaveCount(0)
	await page.evaluate(() => history.pushState(null, "", "/?from=app"))
	await expect(page.locator(".app-nav__row")).toBeVisible()
	expect(await page.evaluate(() => Reflect.get(window, "viewportListenerCounts"))).toEqual({ resize: 1, scroll: 1, removed: 0 })
})
