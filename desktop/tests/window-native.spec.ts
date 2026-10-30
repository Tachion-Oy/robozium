import { expect, type ElectronApplication, type Page } from "@playwright/test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { test, reopen, skipIntro, reloadApp } from "./native"

const contentSize = (app: ElectronApplication) =>
	app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize())
const zoomFactor = (app: ElectronApplication) =>
	app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())
const resize = (app: ElectronApplication, width: number, height: number) =>
	app.evaluate(({ BrowserWindow }, { width, height }) => BrowserWindow.getAllWindows()[0].setContentSize(width, height), { width, height })
const hudWidth = (page: Page) =>
	page.locator(".desktop-workspace .agent-hud").evaluate(element => element.getBoundingClientRect().width)
async function pressZoom(app: ElectronApplication, keyCode: string) {
	await app.evaluate(({ BrowserWindow }, keyCode) => {
		const window = BrowserWindow.getAllWindows()[0]
		const modifier = process.platform === "darwin" ? "meta" : "control"
		window.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers: [modifier] })
		window.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers: [modifier] })
	}, keyCode)
}

test("opening the log adds it beside the HUD and closing detaches it, keeping the HUD's width", async ({ desktop: { app, page } }) => {
	// Xvfb's 1280px screen leaves room for the HUD plus the log's minimum width.
	await resize(app, 660, 650)
	await expect.poll(() => contentSize(app)).toEqual([660, 650])
	await expect.poll(() => hudWidth(page)).toBe(660)
	await page.getByRole("button", { name: "Show message log", exact: true }).click()
	await expect.poll(() => contentSize(app)).toEqual([1140, 650])
	await expect(page.getByRole("region", { name: "Message log" })).toBeVisible()
	await expect.poll(() => hudWidth(page)).toBe(660)
	await page.getByRole("button", { name: "Hide message log", exact: true }).click()
	await expect.poll(() => contentSize(app)).toEqual([660, 650])
	await expect.poll(() => hudWidth(page)).toBe(660)

	// After the user resizes the open window, closing keeps the HUD's column.
	await page.getByRole("button", { name: "Show message log", exact: true }).click()
	await expect.poll(() => contentSize(app)).toEqual([1140, 650])
	await resize(app, 1150, 700)
	await expect.poll(() => contentSize(app)).toEqual([1150, 700])
	const column = await hudWidth(page)
	await page.getByRole("button", { name: "Hide message log", exact: true }).click()
	await expect(page.getByRole("region", { name: "Message log" })).toHaveCount(0)
	await expect.poll(() => contentSize(app)).toEqual([column, 700])
	await expect.poll(() => hudWidth(page)).toBe(column)
})

test("the HUD and its header controls keep their place on every frame while the log opens and closes", async ({ desktop: { app, page } }) => {
	await resize(app, 660, 650)
	await expect.poll(() => contentSize(app)).toEqual([660, 650])
	// Each animation frame records the HUD's width and the view menu's position.
	const record = () => page.evaluate(() => {
		const frames: string[] = []
		Object.assign(window, { hudFrames: frames })
		const tick = () => {
			const menu = document.querySelector(".agent-hud__view-trigger")!.getBoundingClientRect()
			frames.push(`${Math.round(document.querySelector(".agent-hud")!.getBoundingClientRect().width)}@${Math.round(menu.x)}`)
			if (frames.length < 90) requestAnimationFrame(tick)
		}
		requestAnimationFrame(tick)
	})
	const recorded = () => page.evaluate(() => (window as unknown as { hudFrames: string[] }).hudFrames.length)
	const frames = () => page.evaluate(() => [...new Set((window as unknown as { hudFrames: string[] }).hudFrames)])
	await record()
	await expect.poll(recorded).toBeGreaterThanOrEqual(90)
	const [before] = await frames()
	expect(before.startsWith("660@")).toBe(true)
	await record()
	await page.getByRole("button", { name: "Show message log", exact: true }).click()
	await expect.poll(() => contentSize(app)).toEqual([1140, 650])
	await expect(page.getByRole("region", { name: "Message log" })).toBeVisible()
	await expect.poll(recorded).toBeGreaterThanOrEqual(90)
	expect(await frames()).toEqual([before])
	await record()
	await page.getByRole("button", { name: "Hide message log", exact: true }).click()
	await expect.poll(() => contentSize(app)).toEqual([660, 650])
	await expect.poll(recorded).toBeGreaterThanOrEqual(90)
	expect(await frames()).toEqual([before])
})

test("the log stays open across a renderer reload, since main owns it", async ({ desktop: { app, page } }) => {
	await page.getByRole("button", { name: "Show message log", exact: true }).click()
	await expect(page.getByRole("region", { name: "Message log" })).toBeVisible()
	await reloadApp(page)
	await expect(page.getByRole("region", { name: "Message log" })).toBeVisible()
	await expect(page.getByRole("button", { name: "Hide message log", exact: true })).toHaveAttribute("aria-expanded", "true")
	expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isDestroyed())).toBe(false)
})

test("zoom steps by a tenth and zoom and window size survive a restart", async ({ desktop: { app, page }, fakeBackend }) => {
	const profile = await app.evaluate(({ app }) => app.getPath("userData"))
	const settings = path.join(profile, "settings.json")
	await pressZoom(app, "=")
	await pressZoom(app, "=")
	await expect.poll(() => zoomFactor(app)).toBeCloseTo(1.2)
	// A reload keeps the chosen zoom.
	await reloadApp(page)
	await expect(page.locator(".agent-hud__box")).toBeVisible()
	await expect.poll(() => zoomFactor(app)).toBeCloseTo(1.2)
	await resize(app, 1000, 700)
	await expect.poll(async () => JSON.parse(await readFile(settings, "utf8"))).toMatchObject({ zoom: 1.2, window: { width: 1000, height: 700 } })

	const reopened = await reopen(app, profile, fakeBackend.url)
	try {
		const window = await reopened.firstWindow()
		await skipIntro(window)
		await expect(window.locator(".agent-hud__box")).toBeVisible()
		await expect.poll(() => contentSize(reopened)).toEqual([1000, 700])
		await expect.poll(() => zoomFactor(reopened)).toBeCloseTo(1.2)
	} finally { await reopened.close() }
})

test("a window grown by the log is remembered at its earlier size", async ({ desktop: { app, page }, fakeBackend }) => {
	const profile = await app.evaluate(({ app }) => app.getPath("userData"))
	await resize(app, 660, 650)
	await page.getByRole("button", { name: "Show message log", exact: true }).click()
	await expect.poll(() => contentSize(app)).toEqual([1140, 650])
	const reopened = await reopen(app, profile, fakeBackend.url)
	try {
		const window = await reopened.firstWindow()
		await skipIntro(window)
		await expect(window.locator(".agent-hud__box")).toBeVisible()
		await expect.poll(() => contentSize(reopened)).toEqual([660, 650])
	} finally { await reopened.close() }
})
