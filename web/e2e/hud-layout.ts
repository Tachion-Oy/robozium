import { expect, type Page } from "@playwright/test"

/** Await applied viewport updates and finished transitions before sampling layout. */
export async function waitForHudLayout(
	page: Page,
	selectors = [".agent-hud__header", ".agent-hud__header-actions"],
	timeout = 10_000,
): Promise<void> {
	// Let queued resize callbacks run before accepting consecutive equal bounds.
	await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
	let previous = ""
	let stable = 0
	await expect.poll(async () => {
		const sample = await page.evaluate((selectors) => {
			const hud = document.querySelector<HTMLElement>(".agent-hud__box")
			// Inline dimensions are installed by the HUD's client resize effect.
			if (document.fonts.status !== "loaded" || !hud?.style.width || !hud.style.height) return null
			const viewport = window.visualViewport
			if (!viewport || viewport.scale === 1) {
				const rootStyle = getComputedStyle(document.documentElement)
				const expected = {
					height: viewport?.height ?? innerHeight,
					width: viewport?.width ?? innerWidth,
					top: viewport?.offsetTop ?? 0,
					left: viewport?.offsetLeft ?? 0,
				}
				if (Object.entries(expected).some(([name, value]) => {
					const applied = Number.parseFloat(rootStyle.getPropertyValue(`--landing-viewport-${name}`))
					return !Number.isFinite(applied) || Math.abs(applied - value) > 0.5
				})) return null
			}
			// Reduced motion does not disable all control colour transitions.
			// Ignore perpetual cursor animations, but wait for finite effects.
			const animations = hud.getAnimations({ subtree: true })
			if (animations.some((animation) =>
				(animation.pending || animation.playState === "running") &&
				animation.effect?.getComputedTiming().endTime !== Infinity,
			)) return null
			if (animations.some((animation) => animation instanceof CSSTransition)) {
				// WebKit can finish a transition's clock before applying its final
				// style. Flush style invalidation as Playwright's screenshotter does.
				const style = document.createElement("style")
				style.textContent = "body {}"
				document.head.append(style)
				document.documentElement.getBoundingClientRect()
				style.remove()
			}
			const elements = [hud, ...selectors.map((selector) => document.querySelector(selector))]
			if (elements.some((element) => !element)) return null
			const bounds = elements.map((element) => element!.getBoundingClientRect())
			if (bounds.some((rect) => rect.width <= 0 || rect.height <= 0)) return null
			return bounds.map((rect) => [rect.x, rect.y, rect.width, rect.height]
				.map((value) => Math.round(value * 10)))
		}, selectors)
		const current = sample === null ? "" : JSON.stringify(sample)
		stable = current && current === previous ? stable + 1 : 0
		previous = current
		return stable >= 3
	}, { timeout, intervals: [50, 100] }).toBe(true)
	await page.evaluate(() => document.fonts.ready)
}

export async function credentialTableOffset(page: Page): Promise<number> {
	await waitForHudLayout(page, [".agent-hud__table-scroll", ".agent-hud__credential-selector"])
	return page.locator(".agent-hud__table-scroll").evaluate((table) => {
		const hud = document.querySelector(".agent-hud__box")!
		return table.getBoundingClientRect().top - hud.getBoundingClientRect().top
	})
}

/** Keep geometry tolerance separate from visibility and real control access. */
export async function expectCredentialMenuLayout(
	page: Page,
	closedTableOffset: number,
	controlTimeout = process.env.CI ? 15_000 : 5_000,
): Promise<void> {
	const menu = page.getByRole("dialog", { name: "API keys" })
	await expect(menu).toBeVisible()
	await waitForHudLayout(page, [".agent-hud__table-scroll", ".agent-hud__credential-menu"])
	const geometry = await menu.evaluate((element) => {
		const rect = element.getBoundingClientRect()
		const table = document.querySelector(".agent-hud__table-scroll")!.getBoundingClientRect()
		const hud = document.querySelector(".agent-hud__box")!.getBoundingClientRect()
		// Light menus float over the decorative table heading; rows must remain clear.
		const contentTop = document.documentElement.dataset.theme === "light"
			? document.querySelector(".agent-hud__project-row")?.getBoundingClientRect().top ?? table.top
			: table.top
		return {
			tableOffset: table.top - hud.top,
			gap: contentTop - rect.bottom,
			left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
			viewportWidth: innerWidth, viewportHeight: innerHeight,
		}
	})
	expect(Math.abs(geometry.tableOffset - closedTableOffset)).toBeLessThanOrEqual(2)
	expect(geometry.gap).toBeGreaterThanOrEqual(-2)
	expect(geometry.left).toBeGreaterThanOrEqual(-2)
	expect(geometry.top).toBeGreaterThanOrEqual(-2)
	expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth + 2)
	expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 2)
	const label = page.locator(".agent-hud__credential-selector .agent-hud__model-trigger > span")
	expect(await label.evaluate((element) => element.scrollWidth <= element.clientWidth + 2)).toBe(true)
	const password = menu.getByLabel("API key password")
	if (await password.count()) {
		await password.fill("synthetic-layout-test")
		await expect(password).toHaveValue("synthetic-layout-test")
	}
	// A trial click checks clipping, occlusion, and enabled state without sending keys.
	await menu.getByRole("button").click({ trial: true, timeout: controlTimeout })
}
