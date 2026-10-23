import { expect, type ElectronApplication } from "@playwright/test"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { test, documentUrl, preload, reopen } from "./native"

const toggle = "Toggle color theme"

async function backgroundColor(app: ElectronApplication): Promise<string> {
	return (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBackgroundColor())).toLowerCase()
}


test("the chosen theme and window background survive a restart, keeping other settings", async ({ desktop: { app, page } }) => {
	const profile = await app.evaluate(({ app }) => app.getPath("userData"))
	const settings = path.join(profile, "settings.json")
	await writeFile(settings, JSON.stringify({ future: "kept", theme: "dark" }))
	expect(await backgroundColor(app)).toBe("#07080a")

	await page.getByRole("button", { name: toggle }).click()
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
	await expect.poll(async () => JSON.parse(await readFile(settings, "utf8"))).toEqual({ future: "kept", theme: "light" })
	expect(await backgroundColor(app)).toBe("#f3f0e7")

	const reopened = await reopen(app, profile)
	try {
		const window = await reopened.firstWindow()
		await expect(window.locator(".agent-hud__box")).toBeVisible()
		expect(await window.evaluate(() => [document.documentElement.dataset.theme, document.documentElement.style.colorScheme])).toEqual(["light", "light"])
		expect(await backgroundColor(reopened)).toBe("#f3f0e7")
		expect(await reopened.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe("light")
	} finally { await reopened.close() }
})

test("an unreadable settings file opens dark and is never overwritten", async ({ desktop: { app, page } }) => {
	const profile = await app.evaluate(({ app }) => app.getPath("userData"))
	const settings = path.join(profile, "settings.json")
	await writeFile(settings, "{")

	await page.getByRole("button", { name: toggle }).click()
	// The switch still applies for this session.
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
	await expect(page.getByText("Theme not saved")).toBeVisible()
	expect(await readFile(settings, "utf8")).toBe("{")

	const reopened = await reopen(app, profile)
	try {
		const window = await reopened.firstWindow()
		await expect(window.locator(".agent-hud__box")).toBeVisible()
		await expect(window.locator("html")).toHaveAttribute("data-theme", "dark")
		expect(await backgroundColor(reopened)).toBe("#07080a")
	} finally { await reopened.close() }
})

test("setTheme accepts only dark or light from the trusted window and document", async ({ desktop: { app, page } }) => {
	const profile = await app.evaluate(({ app }) => app.getPath("userData"))
	const settings = path.join(profile, "settings.json")
	expect(await page.evaluate(async () => {
		try {
			await Reflect.apply(window.robozium.setTheme, window.robozium, ["sepia"])
			return "allowed"
		} catch {
			return "denied"
		}
	})).toBe("denied")
	expect(await app.evaluate(async ({ BrowserWindow }, { documentUrl, preload }) => {
		const other = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false } })
		try {
			await other.loadURL(documentUrl)
			return await other.webContents.executeJavaScript(`(async () => {
				try {
					await window.robozium.setTheme("light")
					return "allowed"
				} catch {
					return "denied"
				}
			})()`)
		} finally { other.destroy() }
	}, { documentUrl, preload })).toBe("denied")
	await expect(readFile(settings, "utf8")).rejects.toThrow()
	expect(await backgroundColor(app)).toBe("#07080a")
})

test("light tuning knobs scale the accent mixed into buttons", async ({ desktop: { page } }) => {
	await page.getByRole("button", { name: toggle }).click()
	await page.mouse.move(0, 0)
	const start = page.locator(".agent-hud__start").first()
	// The button eases its colours, so read once two samples agree.
	const settled = async () => {
		const read = () => start.evaluate(element => `${getComputedStyle(element).backgroundColor} ${getComputedStyle(element).color}`)
		let previous = await read()
		for (;;) {
			await page.waitForTimeout(150)
			const current = await read()
			if (current === previous) return current
			previous = current
		}
	}
	const initial = await settled()
	await page.evaluate(() => document.documentElement.style.setProperty("--tune-fill", "2"))
	const filled = await settled()
	expect(filled).not.toBe(initial)
	await page.evaluate(() => document.documentElement.style.setProperty("--tune-fill", "1"))
	expect(await settled()).toBe(initial)
	await page.evaluate(() => document.documentElement.style.setProperty("--tune-text", "0.5"))
	expect(await settled()).not.toBe(initial)
})
