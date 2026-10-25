import { _electron, expect } from "@playwright/test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { launchArgs, startupDone, test } from "./native"

const screen = ".startup"
const launchButton = "button:text-is('Launch')"

test("the launch animation plays, then fades into the HUD already drawn beneath it", async ({ fakeBackend }) => {
	const directory = await mkdtemp(path.join(tmpdir(), "robozium-startup-"))
	try {
		const app = await _electron.launch({
			args: launchArgs(fakeBackend.url),
			chromiumSandbox: true,
			cwd: directory,
			env: { ...process.env, ROBOZIUM_DESKTOP_TEST_DATA: path.join(directory, "profile") },
			timeout: 15_000,
		})
		try {
			const page = await app.firstWindow()
			// The window shows only once the intro is rendered, with no font still loading.
			expect(await app.evaluate(({ BrowserWindow }) => new Promise(resolve => {
				const window = BrowserWindow.getAllWindows()[0]
				const shown = () => resolve(window.webContents.executeJavaScript(
					"({ intro: document.querySelector(\".startup[data-stage='intro']\") !== null, loading: [...document.fonts].filter(face => face.status === 'loading').length })"))
				if (window.isVisible()) shown()
				else window.once("show", shown)
			}))).toEqual({ intro: true, loading: 0 })
			await expect(page.locator(`${screen}[data-stage='intro']`)).toBeVisible()
			// The test backend is ready at once, but the introduction finishes first.
			await expect(page.locator(launchButton)).toHaveCount(1)
			await expect(page.locator(`${screen} .startup__hud`)).toHaveCount(0)
			// The fade starts only over a drawn application, so no blank frame shows between them.
			await page.locator(`${screen}[data-stage='handoff']`).waitFor({ timeout: 15_000 })
			await expect(page.locator(launchButton)).toBeVisible()
			await startupDone(page)
			await page.locator(launchButton).click()
		} finally {
			await app.close()
		}
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})

test("a failed start shows its reason and Retry on the loading screen", async ({ desktop: { app, page } }) => {
	await app.evaluate(({ ipcMain }) => {
		let status: object = { state: "error", message: "Docker is not running. Start Docker, then retry." }
		Reflect.set(globalThis, "retries", 0)
		for (const channel of ["backend-status", "retry-backend"]) ipcMain.removeHandler(`desktop:${channel}`)
		ipcMain.handle("desktop:backend-status", () => status)
		ipcMain.handle("desktop:retry-backend", () => {
			Reflect.set(globalThis, "retries", Reflect.get(globalThis, "retries") + 1)
			status = { state: "ready", message: "Backend ready" }
		})
	})
	// Reduced motion shows the loading screen at once.
	await page.emulateMedia({ reducedMotion: "reduce" })
	await page.reload()
	const failure = page.locator(`${screen} .startup__failure`)
	await expect(failure.getByRole("alert")).toHaveText("Docker is not running. Start Docker, then retry.")
	await expect(page.locator(launchButton)).toHaveCount(0)
	await failure.getByRole("button", { name: "Retry", exact: true }).click()
	await startupDone(page)
	await expect(page.locator(launchButton)).toBeVisible()
	expect(await app.evaluate(() => Reflect.get(globalThis, "retries"))).toBe(1)
})
