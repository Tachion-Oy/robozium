import { expect } from "@playwright/test"
import { test, setNativeViewport } from "./native"

test("native viewport keeps the requested zoom after a delayed resize", async ({ desktop: { app, page } }) => {
	await app.evaluate(({ BrowserWindow }) => {
		const window = BrowserWindow.getAllWindows()[0]
		const resize = window.setContentSize.bind(window)
		const originalZoom = window.webContents.getZoomFactor()
		// Hold the native resize, then deliver it with its previous zoom. This
		// reproduces a late resize overwriting zoom applied in the same operation.
		window.setContentSize = (width, height) => {
			Reflect.set(window, "completeTestResize", () => {
				resize(width, height)
				window.webContents.setZoomFactor(originalZoom)
			})
		}
		Reflect.set(window, "restoreTestResize", () => {
			window.setContentSize = resize
			Reflect.deleteProperty(window, "completeTestResize")
			Reflect.deleteProperty(window, "restoreTestResize")
		})
	})
	const resizing = Promise.allSettled([setNativeViewport(app, page, 640, 420, 1.25)])
	try {
		await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
			Reflect.has(BrowserWindow.getAllWindows()[0], "completeTestResize"))).toBe(true)
		await app.evaluate(({ BrowserWindow }) => Reflect.get(BrowserWindow.getAllWindows()[0], "completeTestResize")())
		const [result] = await resizing
		if (result.status === "rejected") throw result.reason
		expect(await page.evaluate(() => [innerWidth, innerHeight])).toEqual([512, 336])
		expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())).toBe(1.25)
	} finally {
		await app.evaluate(({ BrowserWindow }) => Reflect.get(BrowserWindow.getAllWindows()[0], "restoreTestResize")())
		await resizing
	}
})

test("native viewport recovers when native synchronization resets its first zoom", async ({ desktop: { app, page } }) => {
	await app.evaluate(({ BrowserWindow }) => {
		const contents = BrowserWindow.getAllWindows()[0].webContents
		const setZoom = contents.setZoomFactor.bind(contents)
		const original = contents.getZoomFactor()
		let reset = false
		// Model a native synchronization arriving after the resize is visible and
		// undoing the first zoom. Later assignments use the real API unchanged.
		contents.setZoomFactor = zoom => {
			setZoom(zoom)
			if (!reset) { reset = true; setZoom(original) }
		}
		Reflect.set(contents, "restoreTestZoom", () => {
			contents.setZoomFactor = setZoom
			Reflect.deleteProperty(contents, "restoreTestZoom")
		})
	})
	try {
		await setNativeViewport(app, page, 640, 420, 1.25)
		expect(await page.evaluate(() => [innerWidth, innerHeight])).toEqual([512, 336])
		expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())).toBe(1.25)
	} finally {
		await app.evaluate(({ BrowserWindow }) => Reflect.get(BrowserWindow.getAllWindows()[0].webContents, "restoreTestZoom")())
	}
})
