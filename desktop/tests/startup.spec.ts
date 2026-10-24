import { _electron, expect, type ElectronApplication } from "@playwright/test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { appWindow, launchArgs, startupStage, test } from "./native"

async function launch(directory: string, args: string[]): Promise<ElectronApplication> {
	return await _electron.launch({
		args,
		chromiumSandbox: true,
		cwd: directory,
		env: { ...process.env, ROBOZIUM_DESKTOP_TEST_DATA: path.join(directory, "profile") },
		timeout: 15_000,
	})
}

const windowState = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => {
	const window = BrowserWindow.getAllWindows()[0]
	return { visible: window.isVisible(), url: window.webContents.getURL() }
})

test("the launch animation covers the window at once, then fades into the HUD drawn beneath it", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "robozium-startup-"))
	try {
		const app = await launch(directory, launchArgs)
		try {
			await expect.poll(() => startupStage(app)).toBe("intro")
			expect((await windowState(app)).visible).toBe(true)
			// The preview's backend is ready at once; the HUD draws beneath while the introduction plays.
			const page = await appWindow(app)
			await expect(page.getByRole("button", { name: "Launch", exact: true })).toBeVisible()
			expect(await startupStage(app)).toBe("intro")
			// The introduction finishes, the screen fades, and main removes it.
			await expect.poll(() => startupStage(app), { timeout: 20_000 }).toBeNull()
			expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.length)).toBe(0)
			await page.getByRole("button", { name: "Launch", exact: true }).click()
		} finally {
			await app.close()
		}
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})
