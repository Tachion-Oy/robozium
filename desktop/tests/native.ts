import { expect, test as base, type ElectronApplication, type Page } from "@playwright/test"
import { once } from "node:events"
import type { ChildProcess } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

export const desktopRoot = path.resolve(__dirname, "..")
// Use Xvfb even when the host has Wayland; keep screenshot density reproducible.
export const launchArgs = [desktopRoot, "--preview", "--ozone-platform=x11", "--force-device-scale-factor=1"]
export const documentUrl = "robozium://app/index.html"
export const preload = path.join(desktopRoot, "src/preload.cjs")

export async function applicationPage(app: ElectronApplication) {
	await expect.poll(() => app.context().pages().some(page => page.url() === documentUrl)).toBe(true)
	return app.context().pages().find(page => page.url() === documentUrl)!
}

export async function finishSplash(app: ElectronApplication) {
	const splash = app.context().pages().find(page => page.url().endsWith("/splash/index.html"))
	if (splash) {
		await splash.emulateMedia({ reducedMotion: "reduce" })
		await expect.poll(() => splash.isClosed(), { timeout: 10_000 }).toBe(true)
	}
}

export const test = base.extend<{ desktop: { app: ElectronApplication; page: Page } }>({
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
			await app.firstWindow()
			const page = await applicationPage(app)
			const errors: string[] = []
			page.on("pageerror", error => errors.push(error.message))
			await expect(page.getByRole("heading", { name: "Robozium", exact: true })).toBeVisible()
			await expect(page.getByRole("button", { name: "Start run", exact: true })).toBeVisible()
			await finishSplash(app)
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

export async function waitForPanelLayout(page: Page) {
	await page.evaluate(async () => {
		await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
		const animations = document.querySelector(".hud-panels")?.getAnimations({ subtree: true }) ?? []
		await Promise.allSettled(animations.map(animation => animation.finished))
	})
}

export async function setNativeViewport(app: ElectronApplication, page: Page, width: number, height: number, zoom: number) {
	const previousZoom = await app.evaluate(({ BrowserWindow, webContents }, { width, height, url }) => {
		const window = BrowserWindow.getAllWindows()[0]
		const previousZoom = webContents.getAllWebContents().find(contents => contents.getURL() === url)!.getZoomFactor()
		window.setContentSize(width, height)
		return previousZoom
	}, { width, height, url: page.url() })
	// A pending native resize can overwrite a zoom set alongside it. Wait for
	// the renderer to observe the new dimensions before changing its zoom.
	await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight]))
		.toEqual([width / previousZoom, height / previousZoom])
	// A later native synchronization can still reset zoom after the size arrives.
	// Converge setup on both the actual zoom and renderer dimensions before testing.
	await expect.poll(async () => {
		const factor = await app.evaluate(({ webContents }, { zoom, url }) => {
			const contents = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
			for (const page of webContents.getAllWebContents()) page.setZoomFactor(zoom)
			return contents.getZoomFactor()
		}, { zoom, url: page.url() })
		return { factor, size: await page.evaluate(() => [innerWidth, innerHeight]) }
	}).toEqual({ factor: zoom, size: [width / zoom, height / zoom] })
}

export async function captureNative(app: ElectronApplication, page: Page, width: number, height: number) {
	await waitForPanelLayout(page)
	await page.mouse.move(0, 0)
	await page.evaluate(() => new Promise<void>(resolve =>
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
	// CDP screenshots crop at Electron zoom. Wait for the full native surface.
	let screenshot: Buffer | undefined
	await expect.poll(async () => {
		const capture = await app.evaluate(async ({ webContents }, url) => {
			const image = await webContents.getAllWebContents().find(contents => contents.getURL() === url)!.capturePage()
			return { size: image.getSize(), png: image.toPNG().toString("base64") }
		}, page.url())
		screenshot = Buffer.from(capture.png, "base64")
		return capture.size
	}).toEqual({ width, height })
	return screenshot
}
