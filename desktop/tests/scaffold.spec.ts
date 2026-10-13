import { _electron, expect, test as base, type ElectronApplication, type Page } from "@playwright/test"
import { once } from "node:events"
import type { ChildProcess } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const desktopRoot = path.resolve(__dirname, "..")
const documentUrl = pathToFileURL(path.join(desktopRoot, "renderer/index.html")).href
const preload = path.join(desktopRoot, "dist/preload.js")

const test = base.extend<{ desktop: { app: ElectronApplication; page: Page } }>({
	desktop: async ({ playwright }, use, testInfo) => {
		const directory = await mkdtemp(path.join(tmpdir(), "robozium-scaffold-"))
		const logs: string[] = []
		let app: ElectronApplication | undefined
		let child: ChildProcess | undefined
		try {
			app = await playwright._electron.launch({
				args: [desktopRoot],
				chromiumSandbox: true,
				cwd: directory,
				env: { ...process.env, ROBOZIUM_DESKTOP_TEST_DATA: path.join(directory, "profile") },
				timeout: 15_000,
			})
			child = app.process()
			child.stdout?.on("data", chunk => logs.push(String(chunk)))
			child.stderr?.on("data", chunk => logs.push(String(chunk)))
			const page = await app.firstWindow()
			const errors: string[] = []
			page.on("pageerror", error => errors.push(error.message))
			await expect(page.getByRole("heading", { name: "Robozium Desktop" })).toBeVisible()
			await use({ app, page })
			expect(errors).toEqual([])
		} finally {
			try {
				if (app && child?.exitCode === null && child.signalCode === null) {
					await app.close()
				}
			} finally {
				if (child?.exitCode === null && child.signalCode === null) {
					const exited = once(child, "exit")
					child.kill("SIGKILL")
					await exited
				}
				await testInfo.attach("electron.log", { body: logs.join(""), contentType: "text/plain" })
				await rm(directory, { recursive: true, force: true })
			}
		}
	},
})

test("displays the version from main when launched outside the checkout", async ({ desktop: { app, page } }) => {
	const version = await app.evaluate(({ app }) => app.getVersion())
	await expect(page.getByRole("status")).toHaveText(`Version ${version}`)
	expect(page.url()).toBe(documentUrl)
	expect(await page.evaluate(() => ({
		require: typeof Reflect.get(window, "require"),
		process: typeof Reflect.get(window, "process"),
		ipcRenderer: typeof Reflect.get(window, "ipcRenderer"),
		bridge: Object.keys(window.robozium),
	}))).toEqual({ require: "undefined", process: "undefined", ipcRenderer: "undefined", bridge: ["getVersion"] })
	// Playwright disables Chromium sandboxing unless explicitly told otherwise.
	expect(await app.evaluate(({ app }) => app.commandLine.hasSwitch("no-sandbox"))).toBe(false)
})

test("rejects the version request from a different window", async ({ desktop: { app } }) => {
	const result = await app.evaluate(async ({ BrowserWindow }, { preload, documentUrl }) => {
		const other = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false } })
		try {
			await other.loadURL(documentUrl)
			return await other.webContents.executeJavaScript("window.robozium.getVersion().then(() => 'allowed', () => 'denied')")
		} finally { other.destroy() }
	}, { preload, documentUrl })
	expect(result).toBe("denied")
})

test("rejects the version request from a different document in the main window", async ({ desktop: { app, page } }) => {
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].loadURL("about:blank"))
	expect(await page.evaluate(() => window.robozium.getVersion().then(() => "allowed", () => "denied"))).toBe("denied")
})

test("shows a readable error when the version request fails", async ({ desktop: { app, page } }) => {
	await app.evaluate(({ ipcMain }) => ipcMain.removeHandler("desktop:version"))
	await page.reload()
	await expect(page.getByRole("alert")).toHaveText("Unable to read the application version.")
})

test("blocks renderer navigation and popups", async ({ desktop: { app, page } }) => {
	const blocked = await app.evaluate(async ({ BrowserWindow }) => {
		const contents = BrowserWindow.getAllWindows()[0].webContents
		const navigation = new Promise<boolean>(resolve => {
			contents.once("will-frame-navigate", event => resolve(event.defaultPrevented))
		})
		await contents.executeJavaScript("location.href = 'https://example.invalid/'")
		return navigation
	})
	expect(blocked).toBe(true)
	expect(await page.evaluate(() => window.open("https://example.invalid/") === null)).toBe(true)
	expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
	expect(page.url()).toBe(documentUrl)
})

test("native close exits and the same profile can reopen", async ({ desktop: { app } }) => {
	const profile = await app.evaluate(({ app }) => app.getPath("userData"))
	const exited = once(app.process(), "exit")
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
	expect(await exited).toEqual([0, null])
	const reopened = await _electron.launch({
		args: [desktopRoot],
		chromiumSandbox: true,
		cwd: path.dirname(profile),
		env: { ...process.env, ROBOZIUM_DESKTOP_TEST_DATA: profile },
		timeout: 15_000,
	})
	try {
		await expect((await reopened.firstWindow()).getByRole("status")).toHaveText(/^Version /)
	} finally { await reopened.close() }
})
