import { expect } from "@playwright/test"
import { test, documentUrl, preload } from "./native"

for (const method of ["getBackendStatus", "getBackendConnection", "retryBackend"] as const) {
	test(`${method} only accepts the trusted window and document`, async ({ desktop: { app, page } }) => {
		await expect(page.getByRole("button", { name: "Start run", exact: true })).toBeVisible()
		expect(await page.evaluate(() => window.robozium.getBackendStatus())).toEqual({ state: "ready", message: "Local preview" })
		expect(await page.evaluate(() => window.robozium.getBackendConnection())).toBeNull()
		const csp = await app.evaluate(async ({ net }, url) => {
			const response = await net.fetch(url)
			await response.body?.cancel()
			return response.headers.get("Content-Security-Policy")
		}, documentUrl)
		expect(csp?.split("; ")).toContain("connect-src 'none'")
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
