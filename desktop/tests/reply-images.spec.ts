import { expect, type Locator, type Page } from "@playwright/test"
import { documentUrl } from "./native"
import { test, json, prepareRun, snapshot, start, view, replyBox } from "./run-fixture"
import type { Backend } from "./selection-fixture"

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAIAAAA8r+mnAAAAEUlEQVR4nGNQOJCAFTFQTwIAyM0oAY5QpvwAAAAASUVORK5CYII=", "base64")
const imageFile = (name: string, buffer = png, mimeType = "image/png") => ({ name, mimeType, buffer })
const waiting = () => snapshot({ status: "awaiting_user_input", current_prompt_id: "p1", current_prompt: "Question p1" })
const panel = (page: Page) => page.getByRole("group", { name: "Reply composer" })
const previews = (page: Page) => panel(page).getByRole("img")
const send = (page: Page) => page.locator(".agent-hud__send")
const imageButton = (page: Page) => page.getByRole("button", { name: "Add images", exact: true })
const requestsTo = (backend: Backend, method: string, prefix: string) =>
	backend.requests.filter(request => request.method === method && request.path.startsWith(prefix))

interface Attachment { id: string; name: string; path: string; upload_id: string | null }

/** Stage uploads like the backend: one attachment per upload_id, readable through /files. */
function stageImages(backend: Backend, pending: Attachment[] = []) {
	let next = pending.length
	const serve = (attachment: Attachment) => backend.handlers.set(`GET /files/${attachment.path}`, response => {
		response.writeHead(200, { "Content-Type": "image/png" })
		response.end(png)
	})
	pending.forEach(serve)
	backend.handlers.set("GET /run/run-one/files", response => json(response, pending))
	backend.handlers.set("POST /run/run-one/files", response => {
		const query = new URL(backend.requests.at(-1)!.path, "http://backend").searchParams
		const uploadId = query.get("upload_id")
		let attachment = pending.find(item => item.upload_id === uploadId)
		if (!attachment) {
			next += 1
			attachment = { id: `a${next}`, name: query.get("filename")!, path: `.robozium-attachments/a${next}.png`, upload_id: uploadId }
			pending.push(attachment)
			serve(attachment)
		}
		json(response, attachment)
	})
	backend.handlers.set("DELETE /run/run-one/files", response => {
		pending.length = 0
		response.writeHead(204).end()
	})
	for (let index = 1; index <= 8; index++) {
		backend.handlers.set(`DELETE /run/run-one/files/a${index}`, response => {
			pending.splice(pending.findIndex(item => item.id === `a${index}`), 1)
			response.writeHead(204).end()
		})
	}
	return pending
}

async function transferImage(target: Locator, name: string, event: "paste" | "drop") {
	await target.evaluate((element, { bytes, name, event }) => {
		const data = new DataTransfer()
		data.items.add(new File([new Uint8Array(bytes)], name, { type: "image/png" }))
		if (event === "paste") {
			const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true })
			Object.defineProperty(paste, "clipboardData", { value: data })
			element.dispatchEvent(paste)
		} else {
			element.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }))
		}
	}, { bytes: [...png], name, event })
	await expect(target.page().getByRole("img", { name, exact: true })).toBeAttached()
}

async function openWaitingRun(page: Page, backend: Backend) {
	prepareRun(backend)
	backend.handlers.set("GET /run/run-one", response => json(response, waiting()))
	await start(page, backend)
}

test("picker, paste and drop upload images that an image-only reply sends", async ({ desktop: { app, page }, backend }) => {
	const pending = stageImages(backend)
	const replies: unknown[] = []
	backend.handlers.set("POST /run/run-one/reply", (response, body) => {
		replies.push(body)
		pending.length = 0
		json(response, { ok: true })
	})
	await openWaitingRun(page, backend)
	const csp = await app.evaluate(async ({ net }, url) => {
		const response = await net.fetch(url)
		await response.body?.cancel()
		return response.headers.get("Content-Security-Policy")!.split("; ")
	}, documentUrl)
	const origin = csp.find(directive => directive.startsWith("connect-src "))!.slice("connect-src ".length)
	expect(csp).toContain(`img-src 'self' blob: ${origin}`)

	await expect(send(page)).toBeDisabled()
	const chooser = page.waitForEvent("filechooser")
	await imageButton(page).click()
	await (await chooser).setFiles(imageFile("picked.png"))
	await transferImage(panel(page), "pasted.png", "paste")
	await transferImage(replyBox(page), "dropped.png", "drop")
	await expect(previews(page)).toHaveCount(3)
	await expect(panel(page).getByRole("status")).toHaveCount(0)
	expect(pending.map(item => item.name)).toEqual(["picked.png", "pasted.png", "dropped.png"])
	const uploads = requestsTo(backend, "POST", "/run/run-one/files")
	expect(uploads.map(upload => upload.body)).toEqual([png, png, png])
	for (const upload of uploads) {
		expect(new URL(upload.path, "http://backend").searchParams.get("upload_id")).toMatch(/^[0-9a-f-]{36}$/)
	}
	// Local previews load as blob: URLs.
	for (const preview of await previews(page).all()) {
		await expect(preview).toHaveAttribute("src", /^blob:/)
		await expect.poll(() => preview.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(8)
	}

	await expect(send(page)).toBeEnabled()
	await replyBox(page).press("Enter")
	await expect(previews(page)).toHaveCount(0)
	expect(replies).toEqual([{ prompt_id: "p1", content: "" }])
})

test("removing and clearing delete staged images; rejected files are explained", async ({ desktop: { page }, backend }) => {
	const pending = stageImages(backend)
	await openWaitingRun(page, backend)
	const input = panel(page).getByLabel("Choose images")
	await input.setInputFiles([imageFile("one.png"), imageFile("two.png")])
	await expect(previews(page)).toHaveCount(2)
	await expect.poll(() => pending.length).toBe(2)

	await page.getByRole("button", { name: "Remove one.png" }).click()
	await expect(previews(page)).toHaveCount(1)
	expect(requestsTo(backend, "DELETE", "/run/run-one/files").map(request => request.path)).toEqual(["/run/run-one/files/a1"])
	await expect(replyBox(page)).toBeFocused()

	await input.setInputFiles(imageFile("notes.txt", Buffer.from("text"), "text/plain"))
	await expect(panel(page).getByRole("alert")).toHaveText("notes.txt: Use PNG, JPEG, WebP, or GIF images.")
	await input.setInputFiles(imageFile("huge.png", Buffer.alloc(10 * 1024 * 1024 + 1)))
	await expect(panel(page).getByRole("alert")).toHaveText("huge.png: Images must be 10 MiB or smaller.")
	await input.setInputFiles(["a", "b", "c", "d"].map(name => imageFile(`${name}.png`)))
	await expect(panel(page).getByRole("alert")).toContainText("You can attach up to four images.")
	await expect(previews(page)).toHaveCount(1)

	await page.getByRole("button", { name: "Clear reply" }).click()
	await expect(previews(page)).toHaveCount(0)
	expect(requestsTo(backend, "DELETE", "/run/run-one/files").map(request => request.path).at(-1)).toBe("/run/run-one/files")
	expect(pending).toEqual([])
	await expect(page.getByRole("button", { name: "Clear reply" })).toBeDisabled()
})

test("a failed upload keeps its preview, blocks Send and retries with the same upload identity", async ({ desktop: { page }, backend }) => {
	const pending = stageImages(backend)
	const stage = backend.handlers.get("POST /run/run-one/files")!
	let fail = true
	backend.handlers.set("POST /run/run-one/files", (response, body) => {
		if (!fail) return stage(response, body)
		fail = false
		json(response, { detail: "Storage unavailable" }, 500)
	})
	await openWaitingRun(page, backend)
	await replyBox(page).fill("With an image")
	await panel(page).getByLabel("Choose images").setInputFiles(imageFile("flaky.png"))
	await expect(panel(page).getByRole("status").filter({ hasText: "Image update failed" })).toBeVisible()
	await expect(panel(page).getByRole("alert")).toHaveText("API request failed (500): Storage unavailable")
	await expect(send(page)).toBeDisabled()

	await page.getByRole("button", { name: "Retry images" }).click()
	await expect(page.getByRole("button", { name: "Retry images" })).toHaveCount(0)
	await expect(send(page)).toBeEnabled()
	const uploads = requestsTo(backend, "POST", "/run/run-one/files")
	expect(uploads).toHaveLength(2)
	expect(new Set(uploads.map(upload => new URL(upload.path, "http://backend").searchParams.get("upload_id"))).size).toBe(1)
	expect(pending.map(item => item.name)).toEqual(["flaky.png"])
})

test("staged images load from the backend, with the renderer's origin, and survive switching views", async ({ desktop: { page }, backend }) => {
	stageImages(backend, [{ id: "a1", name: "earlier.png", path: ".robozium-attachments/a1.png", upload_id: null }])
	const origins: (string | undefined)[] = []
	const serve = backend.handlers.get("GET /files/.robozium-attachments/a1.png")!
	backend.handlers.set("GET /files/.robozium-attachments/a1.png", (response, body) => {
		origins.push(response.req.headers.origin)
		serve(response, body)
	})
	await openWaitingRun(page, backend)
	const preview = page.getByRole("img", { name: "earlier.png", exact: true })
	await expect(preview).toHaveAttribute("src", /^http:\/\/127\.0\.0\.1:\d+\/files\/\.robozium-attachments\/a1\.png$/)
	await expect.poll(() => preview.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(8)
	expect(origins).toEqual(["robozium://app"])
	await expect(send(page)).toBeEnabled()

	await view(page, "Environment")
	await expect(replyBox(page)).toHaveCount(0)
	await view(page, "Current Run")
	await expect(previews(page)).toHaveCount(1)
	expect(requestsTo(backend, "GET", "/run/run-one/files")).toHaveLength(1)
})
