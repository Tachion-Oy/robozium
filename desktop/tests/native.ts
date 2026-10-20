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
export const preload = path.join(desktopRoot, "dist/preload.js")

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
			const page = await app.firstWindow()
			const errors: string[] = []
			page.on("pageerror", error => errors.push(error.message))
			await expect(page.locator(".agent-hud__box")).toBeVisible()
			await expect(page.getByRole("button", { name: "Launch", exact: true })).toBeVisible()
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

/** Header selectors are buttons named after their current value, with listbox menus. */
export const modelTrigger = (page: Page) => page.locator(".agent-hud__model-trigger:not(.agent-hud__view-trigger)")
export const viewTrigger = (page: Page) => page.locator(".agent-hud__view-trigger")

export async function chooseView(page: Page, name: string) {
	await viewTrigger(page).click()
	await page.getByRole("listbox", { name: "HUD view" }).getByRole("option", { name, exact: true }).click()
}

export async function chooseModel(page: Page, name: string) {
	await modelTrigger(page).click()
	await page.getByRole("listbox", { name: "Base model" }).getByRole("option", { name, exact: true }).click()
}

export async function waitForPanelLayout(page: Page) {
	await page.evaluate(async () => {
		await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
		// The activity logo pulses indefinitely; wait only for finite layout transitions.
		const animations = (document.querySelector(".agent-hud__replySection")?.getAnimations({ subtree: true }) ?? [])
			.filter(animation => animation.effect?.getTiming().iterations !== Infinity)
		await Promise.allSettled(animations.map(animation => animation.finished))
	})
}

/** Resolve once the renderer has drawn two frames; a hidden page draws none. */
const framesDrawn = (page: Page) => page.evaluate(() => new Promise<boolean>(resolve =>
	requestAnimationFrame(() => requestAnimationFrame(() => resolve(document.visibilityState === "visible")))))

export async function setNativeViewport(app: ElectronApplication, page: Page, width: number, height: number, zoom: number) {
	// Chromium holds new visual properties (size and zoom) until the renderer
	// acknowledges the previous ones with a frame, so start from a drawing page.
	await expect.poll(() => framesDrawn(page)).toBe(true)
	const previousZoom = await app.evaluate(({ BrowserWindow }, { width, height }) => {
		const window = BrowserWindow.getAllWindows()[0]
		const previousZoom = window.webContents.getZoomFactor()
		window.setContentSize(width, height)
		return previousZoom
	}, { width, height })
	// A pending native resize can overwrite a zoom set alongside it. Wait for
	// the renderer to observe the new dimensions before changing its zoom.
	await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight]))
		.toEqual([width / previousZoom, height / previousZoom])
	// A later native synchronization can still reset zoom after the size arrives.
	// Converge setup on both the actual zoom and renderer dimensions before testing.
	let stale = false
	try {
		await expect.poll(async () => {
			if (stale) {
				// A zoom the host recorded but the renderer never applied waits for a
				// frame: repaint the window and change the page so the renderer draws.
				await page.evaluate(() => {
					const root = document.documentElement
					root.style.opacity = root.style.opacity === "0.999" ? "" : "0.999"
				})
			}
			const factor = await app.evaluate(({ BrowserWindow }, { zoom, stale }) => {
				const contents = BrowserWindow.getAllWindows()[0].webContents
				// Setting the same factor again is a no-op, so change it first to force a reapply.
				if (stale) {
					contents.invalidate()
					contents.setZoomFactor(zoom === 1 ? 1.1 : 1)
				}
				contents.setZoomFactor(zoom)
				return contents.getZoomFactor()
			}, { zoom, stale })
			const size = await page.evaluate(() => [innerWidth, innerHeight])
			stale = factor === zoom && (size[0] !== width / zoom || size[1] !== height / zoom)
			return { factor, size }
		}).toEqual({ factor: zoom, size: [width / zoom, height / zoom] })
	} catch (error) {
		// Report the window's state, so a failure on a CI runner can be diagnosed.
		const host = await app.evaluate(({ BrowserWindow }) => {
			const window = BrowserWindow.getAllWindows()[0]
			return {
				visible: window.isVisible(), focused: window.isFocused(), minimized: window.isMinimized(),
				contentSize: window.getContentSize(), zoomLevel: window.webContents.getZoomLevel(),
				painting: window.webContents.isPainting(),
			}
		})
		const renderer = await page.evaluate(() => ({ visibility: document.visibilityState, focus: document.hasFocus(), devicePixelRatio }))
		throw new Error(`${error instanceof Error ? error.message : String(error)}\nWindow: ${JSON.stringify(host)}\nRenderer: ${JSON.stringify(renderer)}`)
	} finally {
		await page.evaluate(() => { document.documentElement.style.opacity = "" })
	}
}

export async function captureNative(app: ElectronApplication, page: Page, width: number, height: number) {
	await waitForPanelLayout(page)
	await page.mouse.move(0, 0)
	await page.evaluate(() => new Promise<void>(resolve =>
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
	// CDP screenshots crop at Electron zoom. Wait for the full native surface.
	let screenshot: Buffer | undefined
	await expect.poll(async () => {
		const capture = await app.evaluate(async ({ BrowserWindow }) => {
			const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage()
			return { size: image.getSize(), png: image.toPNG().toString("base64") }
		})
		screenshot = Buffer.from(capture.png, "base64")
		return capture.size
	}).toEqual({ width, height })
	return screenshot
}
