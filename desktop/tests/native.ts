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
			await expect(page.getByRole("heading", { name: "Robozium", exact: true })).toBeVisible()
			await expect(page.getByRole("button", { name: "Start run", exact: true })).toBeVisible()
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
