import { _electron, expect, test as base, type ElectronApplication, type Page } from "@playwright/test"
import { once } from "node:events"
import type { ChildProcess } from "node:child_process"
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const desktopRoot = path.resolve(__dirname, "..")
const documentUrl = "robozium://app/index.html"
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

test("loads the built React script and stylesheet through the local protocol", async ({ desktop: { page } }) => {
	await expect(page.getByRole("status")).toHaveText(/^Version /)
	await expect(page.locator("script[src]")).toHaveAttribute("src", /^\/assets\/.+\.js$/)
	await expect(page.locator('link[rel="stylesheet"]')).toHaveAttribute("href", /^\/assets\/.+\.css$/)
	await expect(page.locator("main")).toHaveCSS("text-align", "center")
	await expect(page.getByRole("heading")).toHaveCSS("font-size", "32px")
})

for (const [name, url, method, status] of [
	["unknown host", "robozium://other/index.html", "GET", 404],
	["missing file", "robozium://app/missing.html", "GET", 404],
	["directory", "robozium://app/assets/", "GET", 404],
	["malformed encoding", "robozium://app/%E0%A4%A", "GET", 400],
	["null byte", "robozium://app/index.html%00", "GET", 400],
	["POST", documentUrl, "POST", 405],
	["HEAD", documentUrl, "HEAD", 405],
] as const) {
	test(`rejects a resource request with ${name}`, async ({ desktop: { app } }) => {
		const result = await app.evaluate(async ({ net }, { url, method }) => {
			const response = await net.fetch(url, { method })
			return { status: response.status, allow: response.headers.get("allow") }
		}, { url, method })
		expect(result.status).toBe(status)
		if (status === 405) expect(result.allow).toBe("GET")
	})
}

test("cannot read outside the renderer directory through traversal or symlinks", async ({ desktop: { app } }) => {
	const outside = await mkdtemp(path.join(desktopRoot, "dist/outside-"))
	const link = path.join(desktopRoot, "dist/renderer", path.basename(outside))
	const marker = "This fixture must never be served by the renderer protocol."
	try {
		await writeFile(path.join(outside, "fixture.html"), marker)
		await symlink(outside, link, "dir")
		for (const [pathname, status] of [
			[`/../${path.basename(outside)}/fixture.html`, 404],
			[`/..%2f${path.basename(outside)}/fixture.html`, 400],
			[`/%2e%2e%5c${path.basename(outside)}/fixture.html`, 400],
			[`/${path.basename(outside)}/fixture.html`, 404],
		] as const) {
			const result = await app.evaluate(async ({ net }, url) => {
				const response = await net.fetch(url)
				return { status: response.status, body: await response.text() }
			}, `robozium://app${pathname}`)
			expect(result.status, pathname).toBe(status)
			expect(result.body).not.toContain(marker)
		}
	} finally {
		await rm(link, { force: true })
		await rm(outside, { recursive: true, force: true })
	}
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
