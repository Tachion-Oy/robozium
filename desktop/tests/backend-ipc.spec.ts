import { expect } from "@playwright/test"
import { test, documentUrl, preload } from "./native"

for (const method of ["getBackendStatus", "getBackendConnection", "retryBackend", "restartBackend", "recreateBackend", "restartApp"] as const) {
	test(`${method} only accepts the trusted window and document`, async ({ desktop: { app, page }, fakeBackend }) => {
		await expect(page.getByRole("button", { name: "Launch", exact: true })).toBeVisible()
		expect(await page.evaluate(() => window.robozium.getBackendStatus())).toEqual({ state: "ready", message: "Connected" })
		expect(await page.evaluate(() => window.robozium.getBackendConnection())).toEqual({ baseUrl: fakeBackend.url })
		const csp = await app.evaluate(async ({ net }, url) => {
			const response = await net.fetch(url)
			await response.body?.cancel()
			return response.headers.get("Content-Security-Policy")
		}, documentUrl)
		expect(csp?.split("; ")).toContain(`connect-src ${fakeBackend.url}`)
		// Retry has no startup to repeat for a backend this launch does not manage.
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

test("a launch given a backend leaves its container and hub files to whoever started it", async ({ desktop: { page } }) => {
	for (const operation of ["restartBackend", "recreateBackend", "openHubFile"] as const) {
		expect(await page.evaluate(async operation => {
			try {
				await (operation === "openHubFile" ? window.robozium.openHubFile("notes.md") : window.robozium[operation]())
				return "allowed"
			} catch (error) {
				return error instanceof Error ? error.message : String(error)
			}
		}, operation), operation).toContain("This launch uses a backend it does not manage.")
	}
	expect(await page.evaluate(() => window.robozium.getHubFolder())).toEqual({ current: null, selected: null, choosable: false })
})

test("the CSP admits bundled images, which the overview's display art uses, local reply previews and hub images", async ({ desktop: { app, page }, fakeBackend }) => {
	const { csp, svg } = await app.evaluate(async ({ net }, url) => {
		const document = await net.fetch(url)
		await document.body?.cancel()
		const art = await net.fetch(new URL("/branding/new-project.svg", url).href)
		await art.body?.cancel()
		return { csp: document.headers.get("Content-Security-Policy"), svg: { status: art.status, type: art.headers.get("Content-Type") } }
	}, documentUrl)
	const directives = csp!.split("; ")
	expect(directives).toContain("default-src 'none'")
	// Bundled art, local reply previews and the backend's hub images load; nothing else does.
	expect(directives.filter(directive => directive.startsWith("img-src"))).toEqual([`img-src 'self' blob: ${fakeBackend.url}`])
	expect(svg).toEqual({ status: 200, type: "image/svg+xml" })
	const art = page.locator(".display-art--new-project")
	await expect(art).toBeVisible()
	expect(await art.evaluate(element => getComputedStyle(element).maskImage)).toContain("/branding/new-project.svg")
	expect(await art.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(40)
})
