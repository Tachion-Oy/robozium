import { expect, test } from "@playwright/test"
import { AgentActivityState } from "../lib/robosprawl/session/reducer"
import { createProject, gotoLanding } from "./helpers"

test.use({ viewport: { width: 1920, height: 1080 } })

test("project actions retain zero inline padding in both themes", async ({ page, request }) => {
	const slug = await createProject(request, `Action Spacing ${Date.now()}`)
	await gotoLanding(page)
	const actions = page.locator("li", {
		has: page.getByRole("button", { name: `Open ${slug}`, exact: true }),
	}).locator(".agent-hud__row-actions")
	await expect(actions).toBeVisible()
	for (const theme of ["dark", "light"] as const) {
		await page.evaluate((nextTheme) => {
			document.documentElement.dataset.theme = nextTheme
		}, theme)
		// Project polling can replace the row during a theme change. Locator
		// assertions reacquire it instead of reading styles from a detached node.
		await expect(actions).toHaveCSS("padding-inline-start", "0px")
		await expect(actions).toHaveCSS("padding-inline-end", "0px")
	}
})

test("switches and persists the integrated light theme", async ({
	page,
	request,
}) => {
	test.setTimeout(60_000)
	await page.emulateMedia({ reducedMotion: "no-preference" })
	await gotoLanding(page)

	const toggle = page.getByRole("button", { name: "Toggle color theme" })
	await expect(toggle).toBeVisible()
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")

	await toggle.click()
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
	await expect
		.poll(async () => {
			const cookies = await page.context().cookies()
			return cookies.find((cookie) => cookie.name === "app.theme.v1")?.value
		})
		.toBe("light")

	const landingLightState = await page.evaluate(() => {
		const hud = document.querySelector(".agent-hud")
		const grip = document.querySelector(".agent-hud__resize-wedge")
		const modelTrigger = document.querySelector(".agent-hud__model-trigger")
		const raster = document.querySelector(".term-scanlines")
		const rasterStyle = raster ? getComputedStyle(raster, "::after") : null
		const rootStyle = getComputedStyle(document.documentElement)
		return {
			canvas: rootStyle.getPropertyValue("--term-bg").trim(),
			backdrop: hud ? getComputedStyle(hud).backgroundColor : null,
			gripDisplay: grip ? getComputedStyle(grip).display : null,
			gripBorder: grip ? getComputedStyle(grip).borderTopStyle : null,
			gripAfter: grip ? getComputedStyle(grip, "::after").content : null,
			modelTriggerBefore: modelTrigger
				? getComputedStyle(modelTrigger, "::before").content
				: null,
			modelTriggerAfter: modelTrigger
				? getComputedStyle(modelTrigger, "::after").content
				: null,
			modelTriggerBorder: modelTrigger
				? getComputedStyle(modelTrigger).borderTopStyle
				: null,
			rasterBackground:
				rasterStyle?.backgroundImage === "none" ? "none" : "painted",
			rasterOpacity: rasterStyle?.opacity,
			rasterBlendMode: rasterStyle?.mixBlendMode,
			rgbStrength: Number.parseFloat(
				rootStyle.getPropertyValue("--term-rgb-mask-opacity"),
			),
			scanlineStrength: Number.parseFloat(
				rootStyle.getPropertyValue("--term-scanline-opacity"),
			),
		}
	})
	expect(landingLightState).toEqual({
		canvas: "#f3f0e7",
		backdrop: "rgba(31, 36, 44, 0.5)",
		gripDisplay: "grid",
		gripBorder: "solid",
		gripAfter: "none",
		modelTriggerBefore: "none",
		modelTriggerAfter: "none",
		modelTriggerBorder: "solid",
		rasterBackground: "painted",
		rasterOpacity: "1",
		rasterBlendMode: "multiply",
		rgbStrength: 0.2,
		scanlineStrength: 0.1,
	})
	const landingModelTrigger = page.locator(".agent-hud__model-trigger").first()
	await landingModelTrigger.hover()
	await expect
		.poll(() =>
			landingModelTrigger.evaluate(
				(element) => getComputedStyle(element).transform,
			),
		)
		.not.toBe("none")
	const slug = await createProject(request, `Theme Toggle ${Date.now()}`)
	const response = await request.post("/api/runs/create", {
		data: { project: slug },
	})
	expect(response.ok()).toBeTruthy()
	const { run_id: runId } = (await response.json()) as { run_id: string }
	await page.goto(`/?runId=${encodeURIComponent(runId)}`)

	await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
	const logo = page.locator(
		'.agent-hud__logo[data-agent-state="working"]',
	).first()
	await expect(logo).toBeVisible({ timeout: 15_000 })
	await page.evaluate(() => {
		document.documentElement.dataset.theme = "dark"
	})
	const darkWorkingPanels = await page.evaluate(() => {
		const agent = document.querySelector(".agent-hud__replyBox--agent")
		const user = document.querySelector(".agent-hud__replyBox--user")
		if (!agent || !user) return null
		return {
			agentOpacity: Number.parseFloat(getComputedStyle(agent).opacity),
			userOpacity: Number.parseFloat(getComputedStyle(user).opacity),
			agentFill: getComputedStyle(agent, "::before").backgroundColor,
			userFill: getComputedStyle(user, "::before").backgroundColor,
		}
	})
	expect(darkWorkingPanels).not.toBeNull()
	expect(darkWorkingPanels?.agentOpacity).toBeLessThan(1)
	expect(darkWorkingPanels?.userOpacity).toBe(1)
	expect(darkWorkingPanels?.agentFill).not.toBe(darkWorkingPanels?.userFill)
	const darkWorkingIndicator = await logo.evaluate((element) => {
		const style = getComputedStyle(element)
		return {
			animationName: style.animationName,
			boxShadow: style.boxShadow,
		}
	})
	expect(darkWorkingIndicator.animationName).toContain("hud-agent-working-pulse")
	expect(darkWorkingIndicator.boxShadow).toContain("0px 0px 9px 0px")
	expect(darkWorkingIndicator.boxShadow).not.toContain("0px 0px 0px 1px")
	await page.evaluate(() => {
		document.documentElement.dataset.theme = "light"
	})
	const logoMotion = await logo.evaluate((element) => ({
		animationName: getComputedStyle(element).animationName,
		prefersReducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
	}))
	expect(logoMotion.prefersReducedMotion).toBe(false)
	expect(logoMotion.animationName).toContain("hud-light-agent-working-invert")
	await expect(page.getByRole("textbox", { name: "Type your reply..." })).toBeVisible()
	const centeredHistoryControls = await page.evaluate(() => {
		const actions = document.querySelector(".agent-hud__actions")
		const navigation = document.querySelector(".agent-hud__message-nav")
		if (!actions || !navigation) return null
		const actionsBounds = actions.getBoundingClientRect()
		const navigationBounds = navigation.getBoundingClientRect()
		return Math.abs(
			actionsBounds.left + actionsBounds.width / 2 -
				(navigationBounds.left + navigationBounds.width / 2),
		)
	})
	expect(centeredHistoryControls).not.toBeNull()
	expect(centeredHistoryControls ?? Number.POSITIVE_INFINITY).toBeLessThan(1)
	const minimize = page.getByRole("button", { name: "Minimize" })
	// The composer is visible while the first reply is still resizing the HUD.
	// Wait for the prompt before hovering, and let the action and CSS assertion
	// use their own timeouts instead of interrupting hover with a shorter wrapper.
	await expect(page.locator(".agent-hud__logo--actions")).toHaveAttribute(
		"data-agent-state",
		AgentActivityState.AwaitingInput,
	)
	await minimize.hover()
	await expect(minimize).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -1)")

	const enabledControlColors = await page.evaluate(() => {
		const selectors = [
			".agent-hud__minimize",
			".agent-hud__layout-direction",
			".agent-hud__cancel",
			".agent-hud__interrupt",
			".agent-hud__dictate",
			".agent-hud__send",
		]
		return selectors.map((selector) => {
			const element = document.querySelector<HTMLButtonElement>(selector)
			return element && !element.disabled
				? getComputedStyle(element).color
				: null
		})
	})
	const visibleControlColors = enabledControlColors.filter(Boolean)
	expect(visibleControlColors.length).toBeGreaterThan(0)
	expect(
		visibleControlColors,
		`Enabled HUD control colors: ${JSON.stringify(enabledControlColors)}`,
	).toEqual(visibleControlColors.map(() => visibleControlColors[0]))

	await minimize.click()
	await expect(page.locator(".agent-hud__mini-expand")).toBeVisible()
	const minimizedStyle = await page.locator(".agent-hud__mini-box").evaluate(
		(element) => ({
			borderRadius: getComputedStyle(element).borderRadius,
			octagonDecoration: getComputedStyle(element, "::after").content,
		}),
	)
	expect(Number.parseFloat(minimizedStyle.borderRadius)).toBeGreaterThan(0)
	expect(minimizedStyle.octagonDecoration).toBe("none")
	await page.locator(".agent-hud__mini-expand").click()
	await expect(page.getByRole("button", { name: "Minimize" })).toBeVisible()

	await page.route("**/api/models", async (route) => {
		if (route.request().method() !== "POST") {
			await route.continue()
			return
		}
		await route.fulfill({
			status: 500,
			contentType: "application/json",
			body: JSON.stringify({ detail: "Synthetic model failure" }),
		})
	})
	await page.getByRole("button", { name: /OpenRouter/ }).click()
	await page.locator('[role="option"]:not([aria-selected="true"])').first().click()
	const toast = page.locator(".agent-error-toast")
	await expect(toast).toBeVisible()
	await expect(toast).toContainText("Model change failed")
	const toastStyle = await toast.evaluate((element) => {
		const style = getComputedStyle(element)
		return {
			color: style.color,
			borderRadius: style.borderRadius,
		}
	})
	expect(toastStyle.color).toBe("rgb(51, 58, 70)")
	expect(Number.parseFloat(toastStyle.borderRadius)).toBeGreaterThan(0)

	await page.reload({ waitUntil: "domcontentloaded" })
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
	await toggle.click()
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
})

test("light carets use stream ink without changing dark role treatments", async ({
	page,
	baseURL,
}) => {
	if (!baseURL) throw new Error("Playwright baseURL is required")
	await page.context().addCookies([
		{ name: "app.theme.v1", value: "light", url: baseURL },
	])
	await page.goto("/")

	const regularCaret = page.locator(".term-caret").first()
	const revealCaret = page.locator(".term-caret--reveal").first()
	await expect(regularCaret).toBeAttached({ timeout: 15_000 })
	await expect(revealCaret).toBeAttached({ timeout: 15_000 })

	const lightCaretStyles = await page.evaluate(() => {
		const regular = document.querySelector<HTMLElement>(".term-caret")
		const reveal = document.querySelector<HTMLElement>(".term-caret--reveal")
		const message = document.querySelector<HTMLElement>(".term-msg-content")
		if (!regular || !reveal || !message) return null
		const regularStyle = getComputedStyle(regular)
		const revealStyle = getComputedStyle(reveal, "::after")
		return {
			textColor: getComputedStyle(message).color,
			regular: {
				background: regularStyle.backgroundColor,
				boxShadow: regularStyle.boxShadow,
				animationName: regularStyle.animationName,
			},
			reveal: {
				background: revealStyle.backgroundColor,
				boxShadow: revealStyle.boxShadow,
				animationName: revealStyle.animationName,
			},
		}
	})
	expect(lightCaretStyles).not.toBeNull()
	expect(lightCaretStyles?.regular).toEqual({
		background: lightCaretStyles?.textColor,
		boxShadow: "none",
		animationName: "term-blink",
	})
	expect(lightCaretStyles?.reveal).toEqual({
		background: lightCaretStyles?.textColor,
		boxShadow: "none",
		animationName: "term-blink",
	})

	await page.evaluate(() => {
		document.documentElement.dataset.theme = "dark"
	})
	const darkRoleStyles = await regularCaret.evaluate((element) => {
		const caret = element as HTMLElement
		const originalRole = caret.dataset.termRole
		const styles = ["agent", "tool", "error"].map((role) => {
			caret.dataset.termRole = role
			const style = getComputedStyle(caret)
			return {
				background: style.backgroundColor,
				boxShadow: style.boxShadow,
			}
		})
		if (originalRole) caret.dataset.termRole = originalRole
		else delete caret.dataset.termRole
		return styles
	})
	expect(new Set(darkRoleStyles.map(({ background }) => background)).size).toBe(3)
	for (const { boxShadow } of darkRoleStyles) {
		expect(boxShadow).not.toBe("none")
	}
})

test("light landing tags use the same gradual settle fade as dark mode", async ({
	page,
	baseURL,
}) => {
	if (!baseURL) throw new Error("Playwright baseURL is required")
	await page.context().addCookies([
		{ name: "app.theme.v1", value: "light", url: baseURL },
	])
	await page.goto("/")

	const plainTag = page.locator(".intro-emph__plain .term-tag").first()
	await expect(plainTag).toBeAttached({ timeout: 15_000 })
	const plainStyle = await plainTag.evaluate((element) => {
		const style = getComputedStyle(element)
		return {
			background: style.backgroundColor,
			boxShadow: style.boxShadow,
		}
	})
	expect(plainStyle).toEqual({
		background: "rgba(0, 0, 0, 0)",
		boxShadow: "none",
	})

	const richLayer = page.locator(".intro-emph__rich").first()
	await expect
		.poll(() =>
			richLayer.evaluate((element) => getComputedStyle(element).animationName),
		)
		.toBe("intro-emph-fade")
})
