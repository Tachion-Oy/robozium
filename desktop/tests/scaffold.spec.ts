import { _electron, expect, test as base, type ElectronApplication, type Page } from "@playwright/test"
import { once } from "node:events"
import type { ChildProcess } from "node:child_process"
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const desktopRoot = path.resolve(__dirname, "..")
// Use Xvfb even when the host has Wayland; keep screenshot density reproducible.
const launchArgs = [desktopRoot, "--ozone-platform=x11", "--force-device-scale-factor=1"]
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
				args: launchArgs,
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
			await expect(page.getByRole("heading", { name: "Robozium", exact: true })).toBeVisible()
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

test("loads the built React script, stylesheet, and font through the local protocol", async ({ desktop: { page } }) => {
	const fontResponse = page.waitForResponse(response =>
		/^robozium:\/\/app\/assets\/source-code-pro-latin-400-normal-.+\.woff2$/.test(response.url()))
	await page.reload()
	expect((await fontResponse).ok()).toBe(true)
	await expect(page.getByRole("status")).toHaveText(/^Version /)
	await expect(page.locator("script[src]")).toHaveAttribute("src", /^\/assets\/.+\.js$/)
	await expect(page.locator('link[rel="stylesheet"]')).toHaveAttribute("href", /^\/assets\/.+\.css$/)
	expect(await page.evaluate(async () => {
		await document.fonts.ready
		return [...document.fonts].map(font => ({ weight: font.weight, status: font.status }))
	})).toEqual([{ weight: "400", status: "loaded" }])
	await expect(page.getByRole("heading")).toHaveCSS("font-family", '"Source Code Pro", ui-monospace, monospace')
})

test("switches themes with the keyboard and mouse while retaining focus", async ({ desktop: { page } }) => {
	const root = page.locator("html")
	const toggle = page.getByRole("button", { name: "Toggle color theme" })
	await expect(page.locator("header button")).toHaveText([
		"Mock model", "Light", "Secrets unavailable", "Runs Overview",
	])
	for (const name of ["Mock model", "Secrets unavailable", "Runs Overview"]) {
		const fixture = page.getByRole("button", { name, exact: true })
		await expect(fixture).toBeDisabled()
		await expect(fixture).toHaveAttribute("disabled", "")
		await expect(fixture).not.toHaveAttribute("aria-haspopup")
		await expect(fixture).not.toHaveAttribute("aria-expanded")
	}
	await expect(root).toHaveAttribute("data-theme", "dark")
	await expect(toggle).toHaveText("Light")
	await page.keyboard.press("Tab")
	await expect(toggle).toBeFocused()
	await expect(toggle).toHaveCSS("outline-style", "solid")
	await expect(toggle).toHaveCSS("outline-width", "2px")
	await page.keyboard.press("Space")
	await expect(root).toHaveAttribute("data-theme", "light")
	await expect(root).toHaveCSS("color-scheme", "light")
	await expect(toggle).toHaveText("Dark")
	await expect(toggle).toBeFocused()
	await expect(toggle).toHaveCSS("outline-width", "2px")
	// The native window wraps focus to its only enabled control in both directions.
	for (const key of ["Tab", "Shift+Tab"]) {
		await page.keyboard.press(key)
		await expect(toggle).toBeFocused()
	}
	await page.keyboard.press("Enter")
	await expect(root).toHaveAttribute("data-theme", "dark")
	await expect(toggle).toBeFocused()
	await toggle.click()
	await expect(root).toHaveAttribute("data-theme", "light")
	await expect(toggle).toBeFocused()
})

for (const [width, height] of [[1260, 780], [640, 420]]) {
	for (const zoom of [1, 1.25]) {
		test(`frame fits ${width}x${height} at ${zoom} zoom in both themes`, async ({ desktop: { app, page } }) => {
			await app.evaluate(({ BrowserWindow }, { width, height, zoom }) => {
				const window = BrowserWindow.getAllWindows()[0]
				window.setContentSize(width, height)
				window.webContents.setZoomFactor(zoom)
			}, { width, height, zoom })
			await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight]))
				.toEqual([width / zoom, height / zoom])
			await expect(page.getByRole("status")).toHaveText(/^Version /)
			await page.evaluate(() => document.fonts.ready.then(() => undefined))
			for (const theme of ["dark", "light"]) {
				if (theme === "light") await page.getByRole("button", { name: "Toggle color theme" }).click()
				await expect(page.locator("html")).toHaveAttribute("data-theme", theme)
				for (const name of ["Mock model", "Secrets unavailable", "Runs Overview"]) {
					const fixture = page.getByRole("button", { name, exact: true })
					await expect(fixture).toHaveAccessibleName(name)
					await expect(fixture).toHaveAttribute("title", name)
				}
				await expect(page.getByRole("button", { name: "Toggle color theme" }))
					.toHaveAttribute("title", `Switch to ${theme === "dark" ? "light" : "dark"} theme`)
				await page.mouse.move(0, 0)
				const geometry = await page.evaluate(() => {
					const frame = document.querySelector("main")!.getBoundingClientRect()
					const header = document.querySelector("header")!.getBoundingClientRect()
					const buttons = [...document.querySelectorAll("header button")]
						.map(element => element.getBoundingClientRect())
					const labels = [...document.querySelectorAll(".hud-header__label")]
					const contents = [...document.querySelectorAll("h1, p, button")]
					return {
						frame: [frame.x, frame.y, frame.width, frame.height],
						contained: contents.every(element => {
							const rect = element.getBoundingClientRect()
							return rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth
								&& rect.bottom <= innerHeight && element.scrollWidth <= element.clientWidth
						}),
						// Native zoom introduces subpixel rounding in DOMRect sums.
						headerContained: buttons.every((rect, index) =>
							rect.x >= header.x - 0.01 && rect.right <= header.right + 0.01
							&& rect.y >= header.y - 0.01 && rect.bottom <= header.bottom + 0.01 && rect.width > 0
							&& (index === 0 || rect.x > buttons[index - 1].right)
							&& Math.abs(rect.y + rect.height / 2 - header.y - header.height / 2) < 1),
						modelCapped: buttons[0].width <= header.width * 0.4,
						labelsReadable: labels.every(element => {
							const style = getComputedStyle(element)
							return element.clientWidth > 0 && (element.scrollWidth <= element.clientWidth
								|| (style.overflow === "hidden" && style.textOverflow === "ellipsis"
									&& style.whiteSpace === "nowrap"))
						}),
						scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
					}
				})
				expect(geometry).toEqual({
					frame: [0, 0, width / zoom, height / zoom],
					contained: true,
					headerContained: true,
					modelCapped: true,
					labelsReadable: true,
					scroll: [width / zoom, height / zoom],
				})
				await page.getByRole("button", { name: "Toggle color theme" }).click({ trial: true })
				await page.mouse.move(0, 0)
				await page.evaluate(() => new Promise<void>(resolve =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
				// Capture the native client area: CDP screenshots crop at Electron zoom.
				// The compositor may still have the old surface after DOM resize completes.
				let screenshot: Buffer | undefined
				await expect.poll(async () => {
					const capture = await app.evaluate(async ({ BrowserWindow }) => {
						const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage()
						return { size: image.getSize(), png: image.toPNG().toString("base64") }
					})
					screenshot = Buffer.from(capture.png, "base64")
					return capture.size
				}).toEqual({ width, height })
				expect(screenshot).toMatchSnapshot(`frame-${theme}-${width}x${height}-${zoom}.png`, {
					threshold: 0.2, maxDiffPixelRatio: 0.002,
				})
			}
		})
	}
}

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
		args: launchArgs,
		chromiumSandbox: true,
		cwd: path.dirname(profile),
		env: { ...process.env, ROBOZIUM_DESKTOP_TEST_DATA: profile },
		timeout: 15_000,
	})
	try {
		await expect((await reopened.firstWindow()).getByRole("status")).toHaveText(/^Version /)
	} finally { await reopened.close() }
})
