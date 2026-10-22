import { expect, type ElectronApplication } from "@playwright/test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { test, reopen } from "./native"

const contentSize = (app: ElectronApplication) =>
	app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize())
const zoomFactor = (app: ElectronApplication) =>
	app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())
const resize = (app: ElectronApplication, width: number, height: number) =>
	app.evaluate(({ BrowserWindow }, { width, height }) => BrowserWindow.getAllWindows()[0].setContentSize(width, height), { width, height })
async function pressZoom(app: ElectronApplication, keyCode: string) {
	await app.evaluate(({ BrowserWindow }, keyCode) => {
		const window = BrowserWindow.getAllWindows()[0]
		const modifier = process.platform === "darwin" ? "meta" : "control"
		window.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers: [modifier] })
		window.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers: [modifier] })
	}, keyCode)
}

test("opening the log grows the window to fit both panes and closing restores it", async ({ desktop: { app, page } }) => {
	await resize(app, 900, 650)
	await expect.poll(() => contentSize(app)).toEqual([900, 650])
	await page.getByRole("button", { name: "Show message log", exact: true }).click()
	await expect.poll(() => contentSize(app)).toEqual([1120, 650])
	await expect(page.getByRole("region", { name: "Message log" })).toBeVisible()
	await page.getByRole("button", { name: "Hide message log", exact: true }).click()
	await expect.poll(() => contentSize(app)).toEqual([900, 650])

	// A size the user chose while the log was open is kept when it closes.
	await page.getByRole("button", { name: "Show message log", exact: true }).click()
	await expect.poll(() => contentSize(app)).toEqual([1120, 650])
	await resize(app, 1000, 700)
	await expect.poll(() => contentSize(app)).toEqual([1000, 700])
	await page.getByRole("button", { name: "Hide message log", exact: true }).click()
	await expect(page.getByRole("region", { name: "Message log" })).toHaveCount(0)
	expect(await contentSize(app)).toEqual([1000, 700])
})

test("the log stays open across a renderer reload, since main owns it", async ({ desktop: { app, page } }) => {
	await page.getByRole("button", { name: "Show message log", exact: true }).click()
	await expect(page.getByRole("region", { name: "Message log" })).toBeVisible()
	await page.reload()
	await expect(page.getByRole("region", { name: "Message log" })).toBeVisible()
	await expect(page.getByRole("button", { name: "Hide message log", exact: true })).toHaveAttribute("aria-expanded", "true")
	expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isDestroyed())).toBe(false)
})

test("zoom steps by a tenth and zoom and window size survive a restart", async ({ desktop: { app, page } }) => {
	const profile = await app.evaluate(({ app }) => app.getPath("userData"))
	const settings = path.join(profile, "settings.json")
	await pressZoom(app, "=")
	await pressZoom(app, "=")
	await expect.poll(() => zoomFactor(app)).toBeCloseTo(1.2)
	// A reload keeps the chosen zoom.
	await page.reload()
	await expect(page.locator(".agent-hud__box")).toBeVisible()
	await expect.poll(() => zoomFactor(app)).toBeCloseTo(1.2)
	await resize(app, 1000, 700)
	await expect.poll(async () => JSON.parse(await readFile(settings, "utf8"))).toMatchObject({ zoom: 1.2, window: { width: 1000, height: 700 } })

	const reopened = await reopen(app, profile)
	try {
		const window = await reopened.firstWindow()
		await expect(window.locator(".agent-hud__box")).toBeVisible()
		await expect.poll(() => contentSize(reopened)).toEqual([1000, 700])
		await expect.poll(() => zoomFactor(reopened)).toBeCloseTo(1.2)
	} finally { await reopened.close() }
})

test("a window grown by the log is remembered at its earlier size", async ({ desktop: { app, page } }) => {
	const profile = await app.evaluate(({ app }) => app.getPath("userData"))
	await resize(app, 900, 650)
	await page.getByRole("button", { name: "Show message log", exact: true }).click()
	await expect.poll(() => contentSize(app)).toEqual([1120, 650])
	const reopened = await reopen(app, profile)
	try {
		await expect((await reopened.firstWindow()).locator(".agent-hud__box")).toBeVisible()
		await expect.poll(() => contentSize(reopened)).toEqual([900, 650])
	} finally { await reopened.close() }
})
