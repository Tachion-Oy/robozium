import { waitForHudLayout } from "./hud-layout"
import { expect, test } from "./fixtures"
import { createProject, gotoLanding } from "./helpers"
import { compareScreenshotPixels } from "./screenshot-comparison"
import nextConfig from "../next.config"

const hubBrand = nextConfig.env!.NEXT_PUBLIC_ROBOZIUM_NAME!.toUpperCase()

test.use({ viewport: { width: 1920, height: 1080 } })

test("the HUD covers the returning title after an enlarged run in both themes", async ({ page, request }, testInfo) => {
	await page.emulateMedia({ reducedMotion: "reduce" })
	const slug = await createProject(request, `Title Overlap ${Date.now()}`)
	await gotoLanding(page)
	await page.getByRole("button", { name: `Open ${slug}`, exact: true }).click()
	await expect(page.locator(".agent-hud__textarea")).toBeVisible({ timeout: 20_000 })
	await page.getByRole("slider", { name: "Resize HUD" }).press("End")
	const cancellation = await request.post(`/api/projects/${encodeURIComponent(slug)}/cancel`)
	expect(cancellation.ok()).toBeTruthy()
	await expect.poll(() => new URL(page.url()).searchParams.get("runId")).toBeNull()
	await expect(page.locator(".agent-hud__project-view")).toBeVisible()
	await expect(page.locator(".app-nav__brand--bar")).toBeVisible()

	for (const viewport of [{ width: 960, height: 500 }, { width: 1280, height: 720 }]) {
		await page.setViewportSize(viewport)
		// WebKit can report stable old bounds before it delivers the resize.
		// Await the new layout before sampling overlap or comparing pixels.
		await expect.poll(() => page.evaluate(() => {
			const title = document.querySelector(".app-nav__brand--bar")!.getBoundingClientRect()
			const hud = document.querySelector(".agent-hud__box")!.getBoundingClientRect()
			return {
				titleCenter: Math.round(title.x + title.width / 2),
				hudWidth: Math.round(hud.width),
				hudHeight: Math.round(hud.height),
			}
		})).toEqual({
			titleCenter: viewport.width / 2,
			hudWidth: Math.round(viewport.width * 0.78),
			hudHeight: Math.round(viewport.height * 0.84),
		})
		for (const theme of ["dark", "light"] as const) {
			await page.evaluate((value) => { document.documentElement.dataset.theme = value }, theme)
			await waitForHudLayout(page)
			const overlap = await page.evaluate(() => {
				const title = document.querySelector(".app-nav__brand--bar")!
				const hud = document.querySelector(".agent-hud__box")!
				const titleBounds = title.getBoundingClientRect()
				const hudBounds = hud.getBoundingClientRect()
				const top = Math.max(titleBounds.top, hudBounds.top)
				const bottom = Math.min(titleBounds.bottom, hudBounds.bottom)
				const x = titleBounds.x + titleBounds.width / 2
				return {
					height: bottom - top,
					uncoveredHeight: hudBounds.top - titleBounds.top,
					covered: {
						x: Math.ceil(titleBounds.left), y: Math.ceil(top) + 4,
						width: Math.floor(titleBounds.width), height: Math.floor(bottom - top) - 8,
					},
					hudInFront: hud.contains(document.elementFromPoint(x, (top + bottom) / 2)),
					uncoveredTitleInFront: title.contains(document.elementFromPoint(x, titleBounds.top + 1)),
				}
			})
			expect(overlap.height).toBeGreaterThan(0)
			expect(overlap.hudInFront).toBe(true)
			if (viewport.height === 720) {
				expect(overlap.uncoveredHeight).toBeGreaterThan(2)
				expect(overlap.uncoveredTitleInFront).toBe(true)
			}
			// Hit testing alone misses a title bleeding through the dark shell.
			// Removing the covered artwork must not visibly change the HUD.
			const screenshotOptions = { clip: overlap.covered, animations: "disabled", caret: "hide" } as const
			const covered = await page.screenshot(screenshotOptions)
			const title = page.locator(".app-nav__brand--bar")
			await title.evaluate((element) => { element.style.visibility = "hidden" })
			const withoutTitle = await page.screenshot(screenshotOptions)
			await title.evaluate((element) => { element.style.removeProperty("visibility") })
			const difference = compareScreenshotPixels(covered, withoutTitle)
			if (difference) {
				await testInfo.attach(`${theme}-with-title`, { body: covered, contentType: "image/png" })
				await testInfo.attach(`${theme}-without-title`, { body: withoutTitle, contentType: "image/png" })
				if (difference.diff) {
					await testInfo.attach(`${theme}-difference`, { body: difference.diff, contentType: "image/png" })
				}
			}
			expect(difference, `${theme} HUD must cover the title: ${difference?.errorMessage ?? "within tolerance"}`).toBeNull()
			await page.locator(".agent-hud__view-trigger").click()
			await expect(page.getByRole("option", { name: "Dependencies", exact: true })).toBeVisible()
			await page.locator(".agent-hud__view-trigger").click()
			await page.screenshot({ path: testInfo.outputPath(`title-overlap-${theme}-${viewport.width}.png`) })
		}
	}
})

test("shows the large centered title and reserves the landing nav row", async ({ page }) => {
	await gotoLanding(page)
	await waitForHudLayout(page)

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
	await waitForHudLayout(page)

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
	await waitForHudLayout(page)
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
					art.bottom + 10 < hud.top
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
	await waitForHudLayout(page)
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
					title.top >= top && title.bottom + 10 < hud.top
			}, { top })).toBe(true)
		}
	}
})

test("preserves normal landing layout without document scrolling", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" })
	await gotoLanding(page)
	await waitForHudLayout(page)
	for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
		await page.setViewportSize(viewport)
		for (const theme of ["dark", "light"] as const) {
			await page.evaluate((value) => { document.documentElement.dataset.theme = value }, theme)
			for (const size of ["Home", "End"] as const) {
				await page.getByRole("slider", { name: "Resize HUD" }).focus()
				await page.keyboard.press(size)
				await expect.poll(() => page.evaluate(({ width, height, expanded }) => {
					const hud = document.querySelector(".agent-hud__box")!.getBoundingClientRect()
					const nav = document.querySelector(".app-nav__row")!.getBoundingClientRect()
					const center = height <= 800 ? (height + nav.height) / 2 : height / 2
					const maximumHeight = height <= 800 ? height - nav.height - 12 : height - 2 * (nav.height + 12)
					const expectedHeight = expanded ? Math.min(height * 0.84, maximumHeight) : 480
					const expectedWidth = expanded ? width * 0.78 : 816
					return Math.abs(hud.y + hud.height / 2 - center) < 1 &&
						Math.abs(hud.height - expectedHeight) < 1 && Math.abs(hud.width - expectedWidth) < 1 &&
						document.documentElement.scrollHeight <= innerHeight + 1
				}, { ...viewport, expanded: size === "End" })).toBe(true)
			}
		}
	}
})

test("scrolls the page to reach HUD controls when a keyboard shrinks only the visible viewport", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" })
	await page.setViewportSize({ width: 1280, height: 900 })
	await page.addInitScript(() => {
		const viewport = Object.assign(new EventTarget(), { height: innerHeight, width: innerWidth, offsetTop: 0, offsetLeft: 0, scale: 1 })
		Object.defineProperty(window, "visualViewport", { value: viewport })
	})
	await gotoLanding(page)
	await waitForHudLayout(page)
	for (const theme of ["dark", "light"] as const) {
		await page.evaluate((value) => {
			window.scrollTo(0, 0)
			document.documentElement.dataset.theme = value
			Object.assign(window.visualViewport!, { height: 300 })
			window.visualViewport!.dispatchEvent(new Event("resize"))
		}, theme)
		await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight > innerHeight)).toBe(true)
		const minimumHeight = await page.locator(".agent-hud__box").evaluate((element) => Number.parseFloat(getComputedStyle(element).minHeight))
		expect(minimumHeight).toBe(480)
		expect((await page.locator(".agent-hud__box").boundingBox())!.height).toBeGreaterThanOrEqual(minimumHeight)
		await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
		await expect.poll(() => page.evaluate(() => {
			const hud = document.querySelector(".agent-hud__box")!.getBoundingClientRect()
			return scrollY > 0 && hud.bottom <= window.visualViewport!.height
		})).toBe(true)
		// Clicking proves that the real control is reachable, rather than merely
		// checking that the shell has a scrollable bounding rectangle.
		await page.getByRole("button", { name: "New Project", exact: true }).click()
		await expect(page.getByRole("textbox", { name: "Project name" })).toBeVisible()
		await page.locator("form").getByRole("button", { name: "Cancel", exact: true }).click()
		await page.evaluate(() => {
			Object.assign(window.visualViewport!, { height: innerHeight })
			window.visualViewport!.dispatchEvent(new Event("resize"))
		})
		await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1 && scrollY === 0)).toBe(true)
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
	await waitForHudLayout(page)
	await page.evaluate(() => history.pushState(null, "", "/?runId=viewport-listener-test"))
	await expect(page.locator(".app-nav__row")).toHaveCount(0)
	await page.evaluate(() => history.pushState(null, "", "/?from=app"))
	await expect(page.locator(".app-nav__row")).toBeVisible()
	expect(await page.evaluate(() => Reflect.get(window, "viewportListenerCounts"))).toEqual({ resize: 1, scroll: 1, removed: 0 })
})
