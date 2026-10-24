import { expect, type ElectronApplication, type Page } from "@playwright/test"
import { test, emit, message, prepareRun, start } from "./run-fixture"
import type { Backend } from "./selection-fixture"

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAIAAAA8r+mnAAAAEUlEQVR4nGNQOJCAFTFQTwIAyM0oAY5QpvwAAAAASUVORK5CYII=", "base64")
const images = "projects/demo/images"
const content = [
	"### Image previews",
	`![Landscape](<${images}/landscape ü.png>)`,
	`![Missing image](${images}/missing.png)`,
	"![Web reference](https://images.example.invalid/reference.png)",
	"![Plain http](http://images.example.invalid/plain.png)",
	`<file src="${images}/landscape ü.png">![Linked](<${images}/landscape ü.png>)</file>`,
	"![Escape](../secret.png) ![Script](javascript:alert(1))",
].join("\n\n")

async function showImages(page: Page, backend: Backend) {
	backend.handlers.set(`GET /files/${images}/landscape%20%C3%BC.png`, response => {
		response.writeHead(200, { "Content-Type": "image/png" })
		response.end(png)
	})
	backend.handlers.set(`GET /files/${images}/missing.png`, response => {
		response.writeHead(404).end()
	})
	const run = prepareRun(backend)
	await start(page, backend)
	await expect.poll(() => run.streams.length).toBe(1)
	emit(run.streams[0], message(1, content))
	const panel = page.locator(".agent-hud__replyBox--agent")
	await expect(panel.getByRole("heading", { name: "Image previews" })).toBeVisible()
	return panel
}

/** Record what main is asked to open instead of opening it. */
async function recordOpened(app: ElectronApplication) {
	await app.evaluate(({ ipcMain, shell }) => {
		const opened: string[] = []
		Reflect.set(globalThis, "opened", opened)
		shell.openExternal = async url => { opened.push(url) }
		ipcMain.removeHandler("desktop:open-hub-file")
		ipcMain.handle("desktop:open-hub-file", (_event, file: string) => { opened.push(`hub:${file}`) })
	})
	return () => app.evaluate(() => Reflect.get(globalThis, "opened") as string[])
}

test("hub images load inline from the backend and only safe sources render", async ({ desktop: { page }, backend }) => {
	const panel = await showImages(page, backend)
	const landscape = panel.getByRole("img", { name: "Landscape", exact: true })
	await expect.poll(() => landscape.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(8)
	await expect(landscape).toHaveAttribute("src", /\/files\/projects\/demo\/images\/landscape%20%C3%BC\.png$/)
	await expect(panel.getByRole("button", { name: "Expand Landscape" })).toHaveAttribute("aria-busy", "false")
	// A linked image previews without a nested button.
	await expect(panel.getByRole("img", { name: "Linked", exact: true })).toBeVisible()
	await expect(panel.getByRole("button", { name: "Expand Linked" })).toHaveCount(0)
	await expect(panel.getByRole("status").filter({ hasText: "Missing image" })).toContainText("Missing image — Image unavailable")
	await expect(panel.getByRole("status").filter({ hasText: "Web reference" })).toContainText("Image unavailable")
	// The CSP admits remote images over https only.
	await expect(panel.getByRole("status").filter({ hasText: "Plain http" })).toContainText("Image unavailable")
	for (const name of ["Escape", "Script"]) await expect(panel).toContainText(`${name} — Image unavailable`)
	const requested = backend.requests.map(request => request.path).filter(path => path.startsWith("/files/"))
	expect(requested.every(path => path.startsWith(`/files/${images}/`))).toBe(true)
})

test("the viewer opens from the keyboard, returns focus and opens the original outside the window", async ({ desktop: { app, page }, backend }) => {
	const opened = await recordOpened(app)
	const panel = await showImages(page, backend)
	const trigger = panel.getByRole("button", { name: "Expand Landscape" })
	await trigger.focus()
	await page.keyboard.press("Enter")
	const dialog = page.getByRole("dialog", { name: "Landscape" })
	await expect(dialog).toBeVisible()
	await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused()
	await expect.poll(() => dialog.getByRole("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(8)
	// The stage reserves the image's size, which the CSP allows as a style property.
	expect(await dialog.locator(".agent-hud__image-stage").evaluate(element => element.style.aspectRatio)).toBe("8 / 4")
	await page.keyboard.press("Tab")
	await expect(dialog.getByRole("link", { name: "Open original" })).toBeFocused()
	const url = page.url()
	await dialog.getByRole("link", { name: "Open original" }).click()
	expect(page.url()).toBe(url)
	await page.keyboard.press("Escape")
	await expect(dialog).toHaveCount(0)
	await expect(trigger).toBeFocused()
	// Escape closed only the viewer; the run stays shown.
	await expect(panel).toBeVisible()
	await panel.getByRole("status").filter({ hasText: "Missing image" }).getByRole("link", { name: "Open original" }).click()
	await panel.getByRole("status").filter({ hasText: "Web reference" }).getByRole("link", { name: "Open original" }).click()
	await expect.poll(opened).toEqual([
		`hub:${images}/landscape ü.png`, `hub:${images}/missing.png`, "https://images.example.invalid/reference.png",
	])
})
