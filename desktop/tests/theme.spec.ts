import { expect, type ElectronApplication } from "@playwright/test"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { test, documentUrl, preload, reopen, skipIntro } from "./native"

const toggle = "Toggle color theme"

async function backgroundColor(app: ElectronApplication): Promise<string> {
	return (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBackgroundColor())).toLowerCase()
}


test("the chosen theme and window background survive a restart, keeping other settings", async ({ desktop: { app, page }, fakeBackend }) => {
	const profile = await app.evaluate(({ app }) => app.getPath("userData"))
	const settings = path.join(profile, "settings.json")
	await writeFile(settings, JSON.stringify({ future: "kept", theme: "dark" }))
	expect(await backgroundColor(app)).toBe("#07080a")
	// The toggle shows the theme a click switches to: the sun in dark, the moon in light.
	const button = page.getByRole("button", { name: toggle })
	await expect(button.locator(".theme-toggle__sun")).toBeVisible()
	await expect(button.locator(".theme-toggle__moon")).toBeHidden()

	await button.click()
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
	await expect(button.locator(".theme-toggle__moon")).toBeVisible()
	await expect(button.locator(".theme-toggle__sun")).toBeHidden()
	await expect.poll(async () => JSON.parse(await readFile(settings, "utf8"))).toEqual({ future: "kept", theme: "light" })
	expect(await backgroundColor(app)).toBe("#fffdf6")

	const reopened = await reopen(app, profile, fakeBackend.url)
	try {
		const window = await reopened.firstWindow()
		await skipIntro(window)
		await expect(window.locator(".agent-hud__box")).toBeVisible()
		expect(await window.evaluate(() => [document.documentElement.dataset.theme, document.documentElement.style.colorScheme])).toEqual(["light", "light"])
		expect(await backgroundColor(reopened)).toBe("#fffdf6")
		expect(await reopened.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe("light")
	} finally { await reopened.close() }
})

test("an unreadable settings file opens dark and is never overwritten", async ({ desktop: { app, page }, fakeBackend }) => {
	const profile = await app.evaluate(({ app }) => app.getPath("userData"))
	const settings = path.join(profile, "settings.json")
	await writeFile(settings, "{")

	await page.getByRole("button", { name: toggle }).click()
	// The switch still applies for this session.
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
	await expect(page.getByText("Theme not saved")).toBeVisible()
	expect(await readFile(settings, "utf8")).toBe("{")

	const reopened = await reopen(app, profile, fakeBackend.url)
	try {
		const window = await reopened.firstWindow()
		await skipIntro(window)
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

test("light tuning knobs scale the accent mixed into the run indicator", async ({ desktop: { page } }) => {
	await page.getByRole("button", { name: "Launch", exact: true }).click()
	await page.getByRole("button", { name: toggle }).click()
	// The switch fades through a view transition; read the colours once it has settled.
	await expect(page.locator('html[data-theme="light"]:not([data-theme-switching])')).toHaveCount(1)
	await page.mouse.move(0, 0)
	// The preview run awaits a reply, so the indicator is tinted with the theme's green.
	const indicator = page.locator('.agent-hud__logo--actions[data-agent-state="awaiting-input"]')
	// The indicator eases its colours, so read once two samples agree.
	const settled = async () => {
		const read = () => indicator.evaluate(element => `${getComputedStyle(element).backgroundColor} ${getComputedStyle(element).color}`)
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

test("both themes name the run view's panels", async ({ desktop: { page } }) => {
	await page.getByRole("button", { name: "Launch", exact: true }).click()
	const labels = page.locator(".agent-hud__panel-label")
	await expect(labels).toHaveText(["Agent", "User"])
	await expect(labels.first()).toBeVisible()
	await expect(labels.last()).toBeVisible()
	await page.getByRole("button", { name: toggle }).click()
	await expect(page.locator('html[data-theme="light"]:not([data-theme-switching])')).toHaveCount(1)
	await expect(labels.first()).toBeVisible()
	await expect(labels.last()).toBeVisible()
})

test("the light stripes keep their width on the screen when the zoom changes", async ({ desktop: { app, page } }) => {
	await page.getByRole("button", { name: toggle }).click()
	// The message log wears the stripes at full strength.
	await page.getByRole("button", { name: "Show message log" }).click()
	await expect(page.locator(".desktop-message-log .term-scanlines")).toBeVisible()
	// One set of three stripes, in screen pixels: the widest of the stripes' own stops.
	const stripes = () => page.evaluate(() => {
		const image = getComputedStyle(document.querySelector(".desktop-message-log .term-scanlines")!, "::after").backgroundImage
		const stops = [...image.matchAll(/([\d.]+)px/g)].slice(0, 6).map(stop => parseFloat(stop[1]))
		return Math.max(...stops) * devicePixelRatio
	})
	expect(await stripes()).toBeCloseTo(5.1, 3)
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25))
	await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(1.25)
	await expect.poll(stripes).toBeCloseTo(5.1, 3)
})

test("in light only the reply panel lights its edge while the user is in it", async ({ desktop: { page } }) => {
	await page.getByRole("button", { name: "Launch", exact: true }).click()
	await page.getByRole("button", { name: toggle }).click()
	await expect(page.locator('html[data-theme="light"]:not([data-theme-switching])')).toHaveCount(1)
	const edge = (panel: string) => page.locator(`.agent-hud__replyBox--${panel}`).evaluate(element => getComputedStyle(element, "::after").borderTopColor)
	// Clicking the agent's message focuses its scroller, which must not light the panel.
	const resting = await edge("agent")
	await page.locator(".agent-hud__replyBox--agent .agent-hud__replyBox-scroll").click()
	await expect(page.locator(".agent-hud__replyBox--agent .agent-hud__replyBox-scroll")).toBeFocused()
	expect(await edge("agent")).toBe(resting)
	await page.getByRole("textbox", { name: "Reply text" }).click()
	expect(await edge("user")).not.toBe(resting)
})

test("the scan lines' row stays one screen pixel when the zoom changes", async ({ desktop: { app, page } }) => {
	const row = () => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--screen-row")) * devicePixelRatio)
	expect(await row()).toBeCloseTo(1, 5)
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25))
	await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(1.25)
	await expect.poll(row).toBeCloseTo(1, 5)
})
