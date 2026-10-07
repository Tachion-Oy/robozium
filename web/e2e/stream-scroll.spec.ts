import { expect, test } from "./fixtures"
import { type Locator, type Page } from "@playwright/test"
import { gotoLanding } from "./helpers"

test.describe.configure({ mode: "serial" })

async function waitForScrollToSettle(log: Locator): Promise<void> {
	let previous = Number.NaN
	let stable = 0
	await expect.poll(async () => {
		const position = await log.evaluate((element) => element.scrollTop)
		stable = Math.abs(position - previous) < 0.1 ? stable + 1 : 0
		previous = position
		return stable >= 3
	}, { timeout: 5_000, intervals: [100] }).toBe(true)
}

async function startRunFromLanding(
	page: Page,
	projectName: string,
): Promise<string> {
	await gotoLanding(page)

	const startButton = page.locator("button.agent-hud__start")
	await expect(startButton).toBeVisible()
	await startButton.click()

	const projectInput = page.getByLabel("Project name")
	await expect(projectInput).toBeVisible()
	await projectInput.fill(projectName)
	const createButton = page.getByRole("form", { name: "Capability selector" }).getByRole("button", { name: "Launch", exact: true })
	await expect(createButton).toBeEnabled()
	await createButton.evaluate((button: HTMLButtonElement) =>
		button.form?.requestSubmit(),
	)
	await expect(page).toHaveURL(/[?&]runId=/, { timeout: 20_000 })

	const runId = new URL(page.url()).searchParams.get("runId")
	expect(runId).toBeTruthy()
	return runId as string
}

test("landing demo log is never scrollable", async ({ page }) => {
	await gotoLanding(page)
	await page.setViewportSize({ width: 1551, height: 1982 })
	const log = page.locator(".term-log").first()
	await expect(log).toBeVisible()
	await expect(log).toHaveCSS("overflow-y", "hidden")
	await expect
		.poll(() =>
			log.evaluate((element) => element.getBoundingClientRect().height),
		)
		.toBeGreaterThan(0)
	const layout = await log.evaluate((element) => {
		const rail = element.parentElement
		if (!rail) return null
		const logBox = element.getBoundingClientRect()
		const railBox = rail.getBoundingClientRect()
		return {
			logHeight: logBox.height,
			railHeight: railBox.height,
			topGap: logBox.top - railBox.top,
			bottomGap: railBox.bottom - logBox.bottom,
		}
	})
	expect(layout).not.toBeNull()
	expect(layout!.logHeight).toBeGreaterThan(0)
	expect(layout!.logHeight).toBeLessThan(layout!.railHeight)
	expect(layout!.topGap).toBeLessThan(2)
	expect(layout!.bottomGap).toBeGreaterThan(0)
})

test("dismissing the HUD unlocks scrolling without shifting the log", async ({
	page,
}) => {
	test.setTimeout(60_000)
	const runId = await startRunFromLanding(page, `stream-scroll-e2e-${Date.now()}`)
	const log = page.locator(".term-log").first()
	const inner = page.locator(".term-log > div").first()
	const hud = page.locator(".agent-hud")

	// First prompt; grow the history with a long reply so the log can overflow
	// once the viewport shrinks below.
	await expect(page.locator(".agent-hud__textarea")).toBeVisible({
		timeout: 15_000,
	})
	await expect(hud).not.toHaveClass(/agent-hud--hidden/)
	await expect(log).toHaveCSS("overflow-y", "hidden")
	await page
		.locator(".agent-hud__textarea")
		.fill(
			"A deliberately long first reply so the terminal log accumulates " +
				"enough wrapped lines of history to overflow a short viewport " +
				"and give the scroll assertions something real to move through. " +
				"x".repeat(600),
		)
	const send = page.getByRole("button", { name: "Send", exact: true })
	await expect(send).toBeEnabled()
	await send.click()
	await expect(
		page.locator(".agent-hud__agent", {
			hasText: "Thanks. One more thing before I finish?",
		}),
	).toBeVisible({ timeout: 15_000 })

	// HUD open: still clipped. Let the long reply finish typing so dismiss /
	// expand aren't racing layout growth (WebKit hover stability is brittle
	// while .term-reveal-pending text is still changing).
	await expect(hud).not.toHaveClass(/agent-hud--hidden/)
	await expect(page.locator(".term-reveal-pending")).toHaveCount(0, {
		timeout: 15_000,
	})
	await expect(log).toHaveCSS("overflow-y", "hidden")
	const boxBefore = await inner.boundingBox()

	// Dismiss: scrollable, and the pre-reserved gutter means zero reflow.
	await page.getByRole("button", { name: "Minimize", exact: true }).click()
	await expect(hud).toHaveClass(/agent-hud--hidden/)
	await expect(log).toHaveCSS("overflow-y", "auto")
	const boxAfter = await inner.boundingBox()
	expect(boxBefore).toBeTruthy()
	expect(boxAfter).toBeTruthy()
	expect(boxAfter!.x).toBeCloseTo(boxBefore!.x, 0)
	expect(boxAfter!.y).toBeCloseTo(boxBefore!.y, 0)
	expect(boxAfter!.width).toBeCloseTo(boxBefore!.width, 0)
	expect(boxAfter!.height).toBeCloseTo(boxBefore!.height, 0)

	// Dismissed HUD: long messages are pointer-cursor and can expand.
	// Skip actionability hover — cursor is class-driven, and WebKit in CI can
	// still see these streaming rows as unstable. scrollIntoView + DOM click
	// avoids that path.
	const expandableMessage = page.locator(".term-msg--interactive").first()
	await expect(expandableMessage).toBeAttached()
	await expect(expandableMessage).toHaveCSS("cursor", "pointer")
	await expandableMessage.evaluate((el) => {
		const node = el as HTMLElement
		node.scrollIntoView({ block: "center" })
		node.click()
	})
	await expect(expandableMessage).toHaveAttribute("aria-expanded", "true")

	// On wide screens the scroll container caps just past the message column,
	// so the scrollbar sits next to the stream, not at the viewport edge.
	await page.setViewportSize({ width: 1920, height: 720 })
	const logBox = (await log.boundingBox())!
	const innerBox = (await inner.boundingBox())!
	const scrollbarGap = logBox.x + logBox.width - (innerBox.x + innerBox.width)
	expect(scrollbarGap).toBeLessThan(96)
	expect(logBox.x + logBox.width).toBeLessThan(1920 - 96)

	// Shrink the viewport so the accumulated history overflows the rail.
	await page.setViewportSize({ width: 640, height: 300 })
	await expect
		.poll(() => log.evaluate((el) => el.scrollHeight > el.clientHeight))
		.toBe(true)
	const scrollStyle = await log.evaluate((element) => {
		const style = getComputedStyle(element)
		return {
			scrollbarWidth: style.scrollbarWidth,
			scrollbarColor: style.scrollbarColor,
		}
	})
	expect(scrollStyle.scrollbarWidth).not.toBe("thin")
	expect(scrollStyle.scrollbarColor).not.toBe("auto")
	const shortRailBox = (await log.locator("..").boundingBox())!
	const shortLogBox = (await log.boundingBox())!
	expect(
		shortRailBox.y + shortRailBox.height -
			(shortLogBox.y + shortLogBox.height),
	).toBeGreaterThan(0)

	// Wheel over the stream scrolls back through history (column-reverse:
	// 0 is the live tail, negative is scrolled up). The mini HUD remains in the
	// left gutter and only its Expand control accepts pointer input.
	await page.mouse.move(320, 150)
	await page.mouse.wheel(0, -400)
	await expect.poll(() => log.evaluate((el) => el.scrollTop)).toBeLessThan(0)
	// Wheel inertia (Chromium/WebKit) keeps gliding after mouse.wheel returns;
	// wait it out before parking a reading position to measure against.
	await waitForScrollToSettle(log)

	// The reading position holds steady across re-renders: distance from the
	// top of the history (scrollHeight + scrollTop) must not drift.
	const readingPosition = await log.evaluate((el) => {
		el.scrollTop = -(el.scrollHeight - el.clientHeight) / 2
		return el.scrollHeight + el.scrollTop
	})
	// Await an actual session refresh before checking that re-rendering preserved it.
	await page.waitForResponse((response) => response.url().includes(`/api/runs/${runId}/view`) && response.ok())
	await waitForScrollToSettle(log)
	expect(await log.evaluate((el) => el.scrollHeight + el.scrollTop)).toBe(
		readingPosition,
	)

	// Reopening the HUD locks scrolling again and snaps back to the live tail.
	await page.locator(".agent-hud__mini-expand").click()
	await expect(hud).not.toHaveClass(/agent-hud--hidden/)
	await expect(log).toHaveCSS("overflow-y", "hidden")
	await expect.poll(() => log.evaluate((el) => el.scrollTop)).toBe(0)
	await expect(page.locator(".term-msg--interactive")).toHaveCount(0)
})
