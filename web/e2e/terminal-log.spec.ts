import { expect, test } from "@playwright/test"
import { gotoLanding } from "./helpers"

test("shows mock terminal message on landing", async ({ page }) => {
	await gotoLanding(page)

	await expect(
		page.getByText("apply_euclidean_path_integral"),
	).toBeVisible({ timeout: 15_000 })
})

test("uses compact bloom for dark-mode badges and inline tags", async ({
	page,
}) => {
	await gotoLanding(page)

    await page.evaluate(() => { document.documentElement.dataset.theme = "dark" })
    for (const selector of [".term-msg-badge", ".term-tag"]) {
        // Landing rows animate and recycle; assert against the currently attached row.
        await expect(page.locator(selector).first()).toHaveCSS("box-shadow", /12px.*24px/)
        await expect(page.locator(selector).first()).not.toHaveCSS("box-shadow", /40px/)
    }

})

test("uses a lightweight dark-mode fill for interactive message hover", async ({
	page,
}) => {
	await gotoLanding(page)

	const probe = page.locator(".term-msg-hover-probe")
	await page.evaluate(() => {
		document.documentElement.dataset.theme = "dark"
        // Keep the CSS probe outside the animated, React-owned landing log.
        const log = document.createElement("div")
        log.className = "term-log term-log--scrollable"
        Object.assign(log.style, { position: "fixed", top: "100px", left: "20px", width: "400px", height: "150px", zIndex: "99999", overflow: "auto" })
        document.body.append(log)

		const row = document.createElement("div")
		row.className =
			"term-msg term-msg--interactive term-msg--hoverable term-msg-hover-probe"
		row.dataset.role = "tool"
		row.tabIndex = 0
		const focusAnchor = document.createElement("button")
		focusAnchor.className = "term-msg-focus-anchor"

		const content = document.createElement("div")
		content.className = "term-msg-content"
		content.textContent = "hover paint probe"
		row.append(content)
		log.append(focusAnchor, row)
	})

	const before = await probe.evaluate((element) => {
		const content = element.querySelector(".term-msg-content")
		if (!content) throw new Error("message content not found")
		return {
			background: getComputedStyle(element).backgroundColor,
			rowShadow: getComputedStyle(element).textShadow,
			contentShadow: getComputedStyle(content).textShadow,
			transitionProperty: getComputedStyle(element).transitionProperty,
		}
	})
	expect(before.transitionProperty).toBe("background-color")

	await probe.hover()
	await expect
		.poll(() =>
			probe.evaluate((element) => getComputedStyle(element).backgroundColor),
		)
		.not.toBe(before.background)

	const hovered = await probe.evaluate((element) => {
		const content = element.querySelector(".term-msg-content")
		if (!content) throw new Error("message content not found")
		return {
			rowShadow: getComputedStyle(element).textShadow,
			contentShadow: getComputedStyle(content).textShadow,
		}
	})
	expect(hovered.rowShadow).toBe(before.rowShadow)
	expect(hovered.contentShadow).toBe(before.contentShadow)

	await page.mouse.move(0, 0)
	await expect
		.poll(() =>
			probe.evaluate((element) => getComputedStyle(element).backgroundColor),
		)
		.toBe(before.background)
	await page.locator(".term-msg-focus-anchor").focus()
	await page.keyboard.press("Tab")
	await expect(probe).toBeFocused()
	await expect
		.poll(() =>
			probe.evaluate((element) => getComputedStyle(element).backgroundColor),
		)
		.not.toBe(before.background)
})
