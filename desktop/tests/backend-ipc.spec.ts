import { expect } from "@playwright/test"
import { test, documentUrl, preload } from "./native"

for (const method of ["getBackendStatus", "retryBackend"] as const) {
	test(`${method} only accepts the trusted window and document`, async ({ desktop: { app, page } }) => {
		await expect(page.getByRole("button", { name: "Start run", exact: true })).toBeVisible()
		expect(await page.evaluate(() => window.robozium.getBackendStatus())).toEqual({ state: "ready", message: "Local preview" })
		await page.evaluate(() => window.robozium.retryBackend())
		expect(await app.evaluate(async ({ BrowserWindow }, { documentUrl, preload, method }) => {
			const other = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false } })
			try {
				await other.loadURL(documentUrl)
				return await other.webContents.executeJavaScript(`(async () => {
					try {
						await window.robozium.${method}()
						return "allowed"
					} catch {
						return "denied"
					}
				})()`)
			} finally { other.destroy() }
		}, { documentUrl, preload, method })).toBe("denied")
		await app.evaluate(async ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].loadURL("data:text/html,untrusted"))
		expect(await page.evaluate(async method => {
			try {
				await window.robozium[method]()
				return "allowed"
			} catch {
				return "denied"
			}
		}, method)).toBe("denied")
	})
}
