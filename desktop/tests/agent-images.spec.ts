import { expect, type ElectronApplication, type Page } from "@playwright/test"
import { test, emit, json, message, prepareRun, snapshot, start } from "./run-fixture"
import type { Backend } from "./selection-fixture"

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAIAAAA8r+mnAAAAEUlEQVR4nGNQOJCAFTFQTwIAyM0oAY5QpvwAAAAASUVORK5CYII=", "base64")
const images = "projects/demo/images"
const web = "https://images.example.invalid"
const content = [
	"### Image previews",
	`![Landscape](<${images}/landscape ü.png>)`,
	`![Missing image](${images}/missing.png)`,
	`![Web reference](${web}/reference.png)`,
	`![Web missing](${web}/missing.png)`,
	`<file src="${images}/landscape ü.png">![Linked](<${images}/landscape ü.png>)</file>`,
	// Raw HTML is not percent-encoded, so a literal "%" stays part of the name.
	`<img src="${images}/100%.png" alt="Percent">`,
	"![Escape](../secret.png) ![Script](javascript:alert(1)) ![Plain](http://images.example.invalid/plain.png)",
].join("\n\n")

async function showImages(page: Page, backend: Backend) {
	for (const name of ["landscape%20%C3%BC.png", "100%25.png"]) {
		backend.handlers.set(`GET /files/${images}/${name}`, response => {
			response.writeHead(200, { "Content-Type": "image/png" })
			response.end(png)
		})
	}
	backend.handlers.set(`GET /files/${images}/missing.png`, response => {
		response.writeHead(404).end()
	})
	// The web host is intercepted in the renderer; only an https request reaches it.
	const referrers: (string | undefined)[] = []
	await page.route(`${web}/**`, route => {
		referrers.push(route.request().headers().referer)
		if (route.request().url() === `${web}/reference.png`) return route.fulfill({ status: 200, contentType: "image/png", body: png })
		return route.fulfill({ status: 404 })
	})
	const run = prepareRun(backend)
	await start(page, backend)
	await expect.poll(() => run.streams.length).toBe(1)
	emit(run.streams[0], message(1, content))
	const panel = page.locator(".agent-hud__replyBox--agent")
	await expect(panel.getByRole("heading", { name: "Image previews" })).toBeVisible()
	return { panel, stream: run.streams[0], referrers }
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

test("hub and https images load inline, failed and unsafe sources keep a link, and hub paths stay on the backend", async ({ desktop: { app, page }, backend }) => {
	const opened = await recordOpened(app)
	const { panel, referrers } = await showImages(page, backend)
	const landscape = panel.getByRole("img", { name: "Landscape", exact: true })
	await expect.poll(() => landscape.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(8)
	await expect(landscape).toHaveAttribute("src", /\/files\/projects\/demo\/images\/landscape%20%C3%BC\.png$/)
	await expect(panel.getByRole("button", { name: "Expand Landscape" })).toHaveAttribute("aria-busy", "false")
	await expect.poll(() => panel.getByRole("img", { name: "Percent" }).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(8)
	// A linked image previews without a nested button.
	await expect(panel.getByRole("img", { name: "Linked", exact: true })).toBeVisible()
	await expect(panel.getByRole("button", { name: "Expand Linked" })).toHaveCount(0)
	// An https image loads from its host, without telling it where the window came from.
	const reference = panel.getByRole("img", { name: "Web reference", exact: true })
	await expect.poll(() => reference.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(8)
	await expect(reference).toHaveAttribute("src", `${web}/reference.png`)
	await expect(panel.getByRole("button", { name: "Expand Web reference" })).toHaveAttribute("aria-busy", "false")
	await expect(panel.getByRole("status").filter({ hasText: "Missing image" })).toContainText("Missing image — Image unavailable")
	await expect(panel.getByRole("status").filter({ hasText: "Web missing" })).toContainText("Web missing — Image unavailable")
	expect(referrers).toEqual([undefined, undefined])
	// Traversal, scripts and plain http never load.
	for (const name of ["Escape", "Script", "Plain"]) await expect(panel).toContainText(`${name} — Image unavailable`)
	const requested = backend.requests.map(request => request.path).filter(path => path.startsWith("/files/"))
	expect(requested.every(path => path.startsWith(`/files/${images}/`))).toBe(true)
	const url = page.url()
	await panel.getByRole("status").filter({ hasText: "Web missing" }).getByRole("link", { name: "Open original" }).click()
	await panel.getByRole("status").filter({ hasText: "Missing image" }).getByRole("link", { name: "Open original" }).click()
	expect(page.url()).toBe(url)
	await expect.poll(opened).toEqual([`${web}/missing.png`, `hub:${images}/missing.png`])
})

test("a model that cannot read images is announced once live, while replayed history stays quiet", async ({ desktop: { page }, backend }) => {
	const text = "Images are omitted for text-model because it cannot read them."
	const omitted = (sequence: number) => ({
		type: "runtime_event", sequence, payload: { category: "llm", kind: "images_omitted", level: "info", agent_name: "orchestrator", message: text },
	})
	const run = prepareRun(backend)
	backend.handlers.set("GET /run/run-one", response => json(response, snapshot({ message_trace: [omitted(1), message(2, "Recovered history")] })))
	await start(page, backend)
	await expect.poll(() => run.streams.length).toBe(1)
	const panel = page.locator(".agent-hud__replyBox--agent")
	await expect(panel).toContainText("Recovered history")
	const notice = page.getByRole("status").filter({ hasText: "Runtime notice" })
	await expect(notice).toHaveCount(0)
	emit(run.streams[0], omitted(3))
	await expect(notice).toBeVisible()
	await expect(notice.locator(".agent-error-toast__message")).toHaveText(text)
	// The run itself shows no message for it; the log does.
	await expect(panel).not.toContainText(text)
})

test("the viewer opens from the keyboard, returns focus and opens the original outside the window", async ({ desktop: { app, page }, backend }) => {
	const opened = await recordOpened(app)
	const { panel } = await showImages(page, backend)
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
	await expect.poll(opened).toEqual([`hub:${images}/landscape ü.png`])
})

test("a new message leaves the viewer open, and closing it then focuses the message panel", async ({ desktop: { page }, backend }) => {
	const { panel, stream } = await showImages(page, backend)
	await panel.getByRole("button", { name: "Expand Landscape" }).click()
	const dialog = page.getByRole("dialog", { name: "Landscape" })
	await expect(dialog).toBeVisible()
	emit(stream, message(2, "A later message"))
	await expect(panel).toContainText("A later message")
	await expect(dialog).toBeVisible()
	await dialog.getByRole("button", { name: "Close", exact: true }).click()
	await expect(dialog).toHaveCount(0)
	await expect(panel.locator(".agent-hud__replyBox-scroll")).toBeFocused()
})
