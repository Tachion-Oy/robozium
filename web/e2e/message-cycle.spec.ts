import { expect, test } from "@playwright/test"
import { createProject, gotoLanding, projectRow } from "./helpers"

test("replies to the active prompt while an older message is displayed", async ({
	page,
	request,
}) => {
	const slug = await createProject(request, `Message Cycle E2E ${Date.now()}`)
	await gotoLanding(page)
	await projectRow(page, slug)
		.getByRole("button", { name: `Open ${slug}` })
		.click()

	const textarea = page.locator(".agent-hud__textarea")
	const previous = page.getByRole("button", {
		name: "Previous agent message",
	})
	const next = page.getByRole("button", { name: "Next agent message" })
	const first = page.getByRole("button", {
		name: "Jump to first agent message",
	})
	const latest = page.getByRole("button", {
		name: "Jump to latest agent message",
	})
	const firstPrompt = page.locator(".agent-hud__agent", {
		hasText: "Hello! I generated a text artifact for validation",
	})
	const secondPrompt = page.locator(".agent-hud__agent", {
		hasText: "Thanks. One more thing before I finish?",
	})

	await expect(firstPrompt).toBeVisible({ timeout: 15_000 })
	await expect(first).toBeDisabled()
	await expect(previous).toBeDisabled()
	await expect(next).toBeDisabled()
	await expect(latest).toBeDisabled()
	let lightDisabledArrowOpacity = 1
	for (const theme of ["dark", "light"] as const) {
		await page.evaluate((nextTheme) => {
			document.documentElement.dataset.theme = nextTheme
		}, theme)
		const hitTargets = await page
			.locator(".agent-hud__message-direction")
			.evaluateAll((buttons) =>
				buttons.map((button) => {
					const bounds = button.getBoundingClientRect()
					return { width: bounds.width, height: bounds.height }
				}),
			)
		expect(hitTargets).toHaveLength(4)
		for (const target of hitTargets) {
			expect(target.width).toBeGreaterThanOrEqual(36)
				expect(target.height).toBeGreaterThanOrEqual(36)
			}
		const disabledArrowOpacity = await first
			.locator(".agent-hud__message-wedge")
			.evaluate((wedge) => Number.parseFloat(getComputedStyle(wedge).opacity))
		expect(disabledArrowOpacity).toBeLessThanOrEqual(0.25)
		if (theme === "light") {
			lightDisabledArrowOpacity = disabledArrowOpacity
			const awaitingIndicator = await page
				.locator(
					'.agent-hud__logo--actions[data-agent-state="awaiting-input"]',
				)
				.evaluate((logo) => {
					const style = getComputedStyle(logo)
					return {
						animationName: style.animationName,
						boxShadow: style.boxShadow,
					}
				})
			expect(awaitingIndicator.animationName).toBe("none")
			expect(awaitingIndicator.boxShadow).not.toBe("none")
		} else {
			const panelOpacity = await page.evaluate(() => ({
				agent: Number.parseFloat(
					getComputedStyle(
						document.querySelector(".agent-hud__replyBox--agent")!,
					).opacity,
				),
				user: Number.parseFloat(
					getComputedStyle(
						document.querySelector(".agent-hud__replyBox--user")!,
					).opacity,
				),
			}))
			expect(panelOpacity).toEqual({ agent: 1, user: 1 })
			const darkGripGeometry = await page
				.locator(".agent-hud__resize-wedge")
				.evaluate((grip) => ({
					before: getComputedStyle(grip, "::before").clipPath,
					after: getComputedStyle(grip, "::after").clipPath,
				}))
			expect(darkGripGeometry.before).toContain("polygon")
			expect(darkGripGeometry.after).toContain("polygon")
			expect(darkGripGeometry.before).not.toBe(darkGripGeometry.after)
		}
	}
	await page.evaluate(() => {
		document.documentElement.dataset.theme = "dark"
	})

	await textarea.fill("first reply")
	await page.getByRole("button", { name: "Send", exact: true }).click()
	await expect(secondPrompt).toBeVisible({ timeout: 15_000 })

	await textarea.fill("draft for the latest prompt")
	await expect(first).toBeEnabled()
	await expect(previous).toBeEnabled()
	await expect(latest).toBeDisabled()
	await page.evaluate(() => {
		document.documentElement.dataset.theme = "light"
	})
	const lightEnabledArrowOpacity = await first
		.locator(".agent-hud__message-wedge")
		.evaluate((wedge) => Number.parseFloat(getComputedStyle(wedge).opacity))
	expect(lightEnabledArrowOpacity).toBeGreaterThan(lightDisabledArrowOpacity)
	await page.evaluate(() => {
		document.documentElement.dataset.theme = "dark"
	})
	await first.click()

	await expect(firstPrompt).toBeVisible()
	await expect(textarea).toBeEnabled()
	await expect(textarea).toHaveValue("draft for the latest prompt")
	await expect(textarea).toHaveAttribute("placeholder", "Type your reply...")
	await expect(previous).toBeDisabled()
	await expect(next).toBeEnabled()
	await expect(latest).toBeEnabled()

	await latest.click()
	await expect(secondPrompt).toBeVisible()
	await expect(latest).toBeDisabled()
	await first.click()
	await expect(firstPrompt).toBeVisible()

	await page.getByRole("button", { name: "Send", exact: true }).click()
	await expect(textarea).toHaveCount(0, { timeout: 15_000 })
})
