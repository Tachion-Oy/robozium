import { expect, type Page } from "@playwright/test"
import { writeFile } from "node:fs/promises"
import { test, json, prepareRun, start, replyBox, launchButton, view, project } from "./run-fixture"
import { captureNative, setNativeViewport, waitForPanelLayout } from "./native"
import type { Backend } from "./selection-fixture"

const toast = (page: Page) => page.getByRole("alert").filter({ hasText: "Stop failed" })
const cancel = (page: Page) => page.locator(".agent-hud__cancel")

async function refusedCancel(page: Page, backend: Backend) {
	prepareRun(backend)
	backend.handlers.set("POST /projects/existing-project/cancel", response => json(response, { ok: false }))
	await start(page, backend)
}

async function freeze(page: Page) {
	// The installed clock starts running, so pause ahead of the install time, never at it.
	const now = new Date("2026-10-21T12:00:00Z")
	await page.clock.install({ time: now.getTime() - 1000 })
	await page.clock.pauseAt(now)
}

for (const theme of ["dark", "light"]) {
	test(`error toasts overlay the HUD and fit narrow zoomed windows in ${theme}`, async ({ desktop: { app, page }, backend }, testInfo) => {
		const violations: string[] = []
		page.on("console", message => {
			if (/Content Security Policy|violates.*directive/i.test(message.text())) violations.push(message.text())
		})
		await refusedCancel(page, backend)
		if (theme === "light") await page.getByRole("button", { name: "Toggle color theme" }).click()
		await setNativeViewport(app, page, 640, 420, 1.25)
		const hud = await page.locator(".agent-hud__box").boundingBox()
		await cancel(page).click()
		const notice = toast(page)
		await expect(notice.locator(".agent-error-toast__title")).toHaveText("Stop failed")
		await expect(notice.locator(".agent-error-toast__message")).toHaveText('Could not stop "existing-project".')
		await expect(notice.locator(".agent-error-toast__detail")).toHaveText("The project is still active. Try again.")
		await expect(notice).toHaveAttribute("aria-live", "assertive")
		await expect(notice.getByRole("button", { name: "Dismiss error notification" })).toBeVisible()
		await waitForPanelLayout(page)
		const bounds = (await notice.boundingBox())!
		const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
		expect(bounds.x).toBeGreaterThanOrEqual(0)
		expect(bounds.y).toBeGreaterThanOrEqual(0)
		expect(bounds.y).toBeLessThanOrEqual(20)
		expect(Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2)).toBeLessThan(1)
		expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
		expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height)
		expect(await page.locator(".agent-hud__box").boundingBox()).toEqual(hud)
		expect(await notice.evaluate(element => {
			const box = element.getBoundingClientRect()
			return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
		})).toBe(true)
		await expect(page.getByRole("region", { name: "Notifications" }).locator("[style]")).toHaveCount(0)
		await expect(page.getByRole("region", { name: "Notifications" })).not.toHaveAttribute("style")
		const screenshot = testInfo.outputPath(`toast-${theme}-640-1.25.png`)
		await writeFile(screenshot, (await captureNative(app, page, 640, 420))!)
		await testInfo.attach(`toast-${theme}-640-1.25.png`, { path: screenshot, contentType: "image/png" })
		expect(violations).toEqual([])
	})
}

test("a successful environment reset uses a polite success toast", async ({ desktop: { page }, backend }) => {
	backend.handlers.set("GET /credentials/environment", response => json(response, {
		revision: "r1", entries: [], overrides: [], requires_password: false, editable: true,
		suggestions: [], example_errors: [], imports: [],
	}))
	backend.handlers.set("DELETE /credentials/environment", response => json(response, { status: "reset" }))
	await backend.open()
	await view(page, "Environment")
	await page.getByRole("button", { name: "Reset environment" }).click()
	await page.getByRole("button", { name: "Yes, reset" }).click()
	const notice = page.getByRole("status").filter({ hasText: "Environment reset" })
	await expect(notice).toHaveClass(/agent-error-toast--success/)
	await expect(notice).toHaveAttribute("aria-live", "polite")
	await expect(notice.getByRole("button", { name: "Dismiss success notification" })).toBeVisible()
})

test("Dismiss plays the exit animation and preserves reply focus", async ({ desktop: { page }, backend }) => {
	await refusedCancel(page, backend)
	await freeze(page)
	await cancel(page).click()
	await expect(toast(page)).toBeVisible()
	await page.clock.runFor(200)
	await replyBox(page).fill("Keep my draft")
	await toast(page).getByRole("button", { name: "Dismiss error notification" }).click()
	await expect(toast(page)).toHaveClass(/agent-error-toast--hidden/)
	await expect(replyBox(page)).toBeFocused()
	await page.clock.runFor(249)
	await expect(toast(page)).toHaveCount(1)
	await page.clock.runFor(1)
	await expect(toast(page)).toHaveCount(0)
	await expect(replyBox(page)).toBeFocused()
	await expect(replyBox(page)).toHaveValue("Keep my draft")
	// Keyboard users can dismiss and return to the same editor too.
	await cancel(page).click()
	await replyBox(page).focus()
	await toast(page).getByRole("button", { name: "Dismiss error notification" }).focus()
	await page.keyboard.press("Enter")
	await expect(replyBox(page)).toBeFocused()
	await page.clock.runFor(250)
	await expect(toast(page)).toHaveCount(0)
})

test("a toast expires after five seconds plus its removal delay", async ({ desktop: { page }, backend }) => {
	await refusedCancel(page, backend)
	await freeze(page)
	await cancel(page).click()
	await expect(toast(page)).toBeVisible()
	await page.clock.runFor(4999)
	await expect(toast(page)).toHaveClass(/agent-error-toast--visible/)
	await page.clock.runFor(1)
	await expect(toast(page)).toHaveClass(/agent-error-toast--hidden/)
	await page.clock.runFor(250)
	await expect(toast(page)).toHaveCount(0)
})

test("hover pauses the remaining lifetime and leaving resumes it", async ({ desktop: { page }, backend }) => {
	await refusedCancel(page, backend)
	await freeze(page)
	await cancel(page).click()
	await expect(toast(page)).toBeVisible()
	await page.clock.runFor(2000)
	await toast(page).hover()
	await page.clock.runFor(10_000)
	await expect(toast(page)).toHaveClass(/agent-error-toast--visible/)
	await page.mouse.move(0, 0)
	await page.clock.runFor(2999)
	await expect(toast(page)).toHaveClass(/agent-error-toast--visible/)
	await page.clock.runFor(1)
	await expect(toast(page)).toHaveClass(/agent-error-toast--hidden/)
	await page.clock.runFor(250)
	await expect(toast(page)).toHaveCount(0)
})

test("a repeated launch failure replaces its title and restarts its lifetime", async ({ desktop: { page }, backend }) => {
	let attempt = 0
	backend.handlers.set("POST /run/create", response => json(response, { detail: `Unavailable attempt ${++attempt}` }, 503))
	await backend.open()
	await freeze(page)
	await launchButton(page, "existing-project").click()
	await expect(page.getByRole("alert")).toContainText("Unavailable attempt 1")
	await page.clock.runFor(4000)
	await launchButton(page, "existing-project").click()
	await expect(page.getByRole("alert")).toHaveCount(1)
	await expect(page.getByRole("alert")).toContainText("Unavailable attempt 2")
	await page.clock.runFor(4999)
	await expect(page.getByRole("alert")).toHaveClass(/agent-error-toast--visible/)
	await page.clock.runFor(251)
	await expect(page.getByRole("alert")).toHaveCount(0)
})

test("different failures stack separately and dismiss independently", async ({ desktop: { app, page }, backend }) => {
	await refusedCancel(page, backend)
	await replyBox(page).fill("Keep my reply")
	await app.evaluate(({ clipboard }) => {
		clipboard.writeText = () => { throw new Error("Test clipboard unavailable") }
	})
	await page.getByRole("button", { name: "Copy user reply" }).click()
	await cancel(page).click()
	const copy = page.getByRole("alert").filter({ hasText: "Copy failed" })
	await expect(copy).toBeVisible()
	await expect(toast(page)).toBeVisible()
	await waitForPanelLayout(page)
	const first = (await copy.boundingBox())!
	const second = (await toast(page).boundingBox())!
	expect(second.y).toBeGreaterThan(first.y + first.height)
	await copy.getByRole("button", { name: "Dismiss error notification" }).click()
	await expect(copy).toHaveCount(0)
	await expect(toast(page)).toBeVisible()
})

test("removing a hovered toast resumes the others once the pointer is elsewhere", async ({ desktop: { app, page }, backend }) => {
	await refusedCancel(page, backend)
	await replyBox(page).fill("Keep my reply")
	await app.evaluate(({ clipboard }) => {
		clipboard.writeText = () => { throw new Error("Test clipboard unavailable") }
	})
	await freeze(page)
	await page.getByRole("button", { name: "Copy user reply" }).click()
	await cancel(page).click()
	const copy = page.getByRole("alert").filter({ hasText: "Copy failed" })
	await expect(toast(page)).toBeVisible()
	// The pointer stays still while the dismissed toast leaves, then moves to the HUD.
	await copy.getByRole("button", { name: "Dismiss error notification" }).click()
	await page.clock.runFor(250)
	await expect(copy).toHaveCount(0)
	const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
	await page.mouse.move(viewport.width / 2, viewport.height - 10)
	await page.clock.runFor(5000)
	await expect(toast(page)).toHaveClass(/agent-error-toast--hidden/)
})

test("keyboard dismissal without an earlier focus moves to the next toast", async ({ desktop: { app, page }, backend }) => {
	await refusedCancel(page, backend)
	await replyBox(page).fill("Keep my reply")
	await app.evaluate(({ clipboard }) => {
		clipboard.writeText = () => { throw new Error("Test clipboard unavailable") }
	})
	await page.getByRole("button", { name: "Copy user reply" }).click()
	await cancel(page).click()
	const copy = page.getByRole("alert").filter({ hasText: "Copy failed" })
	await expect(toast(page)).toBeVisible()
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
	await copy.getByRole("button", { name: "Dismiss error notification" }).focus()
	await page.keyboard.press("Enter")
	await expect(toast(page).getByRole("button", { name: "Dismiss error notification" })).toBeFocused()
})

test("a toast that waits for an answer stays, keeps one copy, and leaves with its action or Dismiss", async ({ desktop: { page }, backend }) => {
	backend.handlers.set("GET /projects", response => json(response, { detail: "Storage unreadable" }, 500))
	await page.clock.install()
	await backend.open({ awaitOverview: false })
	const failure = page.getByRole("region", { name: "Notifications" }).locator(".agent-error-toast--visible", { hasText: "Could not load projects" })
	await expect(failure).toBeVisible()
	// Timed toasts leave after five seconds; this one stays through later failed reads, once.
	await page.clock.fastForward(12_000)
	await expect(failure).toHaveCount(1)
	await expect(failure).toBeVisible()
	// Dismiss always remains, so a toast never traps the controls beneath it. A
	// dismissed problem stays hidden while it is unchanged, and returns with the view.
	await failure.getByRole("button", { name: /^Dismiss/ }).click()
	await expect(failure).toHaveCount(0)
	await page.clock.fastForward(6_000)
	await expect(failure).toHaveCount(0)
	await view(page, "Dependencies")
	await view(page, "Runs Overview")
	await expect(failure).toBeVisible()
	backend.handlers.set("GET /projects", response => json(response, [project("existing-project")]))
	await failure.getByRole("button", { name: "Retry", exact: true }).click()
	await expect(failure).toHaveCount(0)
	await expect(launchButton(page, "existing-project")).toBeVisible()
})
