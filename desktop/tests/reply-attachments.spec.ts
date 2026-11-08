import { expect, type Locator, type Page } from "@playwright/test"
import { documentUrl, inlineAlerts, toast } from "./native"
import { test, json, prepareRun, snapshot, start, view, replyBox } from "./run-fixture"
import type { Backend } from "./selection-fixture"

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAIAAAA8r+mnAAAAEUlEQVR4nGNQOJCAFTFQTwIAyM0oAY5QpvwAAAAASUVORK5CYII=", "base64")
const pdf = Buffer.from("%PDF-1.7\n%%EOF\n")
const xlsx = Buffer.from("PK\u0003\u0004 workbook")
const imageFile = (name: string, buffer = png, mimeType = "image/png") => ({ name, mimeType, buffer })
const waiting = () => snapshot({ status: "awaiting_user_input", current_prompt_id: "p1", current_prompt: "Question p1" })
const panel = (page: Page) => page.getByRole("group", { name: "Reply composer" })
const previews = (page: Page) => panel(page).getByRole("img")
const send = (page: Page) => page.locator(".agent-hud__send")
const imageButton = (page: Page) => page.getByRole("button", { name: "Add files", exact: true })
const requestsTo = (backend: Backend, method: string, prefix: string) =>
	backend.requests.filter(request => request.method === method && request.path.startsWith(prefix))

interface Attachment { id: string; name: string; path: string; kind: "image" | "file"; upload_id: string | null }

/** Stage uploads like the backend: one attachment per upload_id, readable through /files. */
function stageImages(backend: Backend, pending: Attachment[] = []) {
	let next = pending.length
	const serve = (attachment: Attachment) => backend.handlers.set(`GET /files/${attachment.path}`, response => {
		response.writeHead(200, { "Content-Type": "image/png" })
		response.end(png)
	})
	pending.forEach(serve)
	backend.handlers.set("GET /run/run-one/files", response => json(response, pending))
	backend.handlers.set("POST /run/run-one/files", (response, body) => {
		const query = new URL(backend.requests.at(-1)!.path, "http://backend").searchParams
		const uploadId = query.get("upload_id")
		let attachment = pending.find(item => item.upload_id === uploadId)
		if (!attachment) {
			next += 1
			// Like the backend, decide the kind from the bytes: only real PNGs are images.
			const name = query.get("filename")!
			const kind = png.subarray(0, 8).equals((body as Buffer).subarray(0, 8)) ? "image" : "file"
			attachment = { id: `a${next}`, name, path: `.robozium-attachments/a${next}.${name.split(".").pop()}`, kind, upload_id: uploadId }
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

async function transferFile(target: Locator, name: string, event: "paste" | "drop", buffer = png, type = "image/png") {
	await target.evaluate((element, { bytes, name, event, type }) => {
		const data = new DataTransfer()
		data.items.add(new File([new Uint8Array(bytes)], name, { type }))
		if (event === "paste") {
			const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true })
			Object.defineProperty(paste, "clipboardData", { value: data })
			element.dispatchEvent(paste)
		} else {
			element.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }))
		}
	}, { bytes: [...buffer], name, event, type })
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
	expect(csp).toContain(`img-src 'self' blob: https: ${origin}`)

	await expect(send(page)).toBeDisabled()
	const chooser = page.waitForEvent("filechooser")
	await imageButton(page).click()
	await (await chooser).setFiles(imageFile("picked.png"))
	await transferFile(panel(page), "pasted.png", "paste")
	await transferFile(replyBox(page), "dropped.png", "drop")
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
	const input = panel(page).getByLabel("Choose files")
	await input.setInputFiles([imageFile("one.png"), imageFile("two.png")])
	await expect(previews(page)).toHaveCount(2)
	await expect.poll(() => pending.length).toBe(2)

	// A removal hides its preview at once; the request reaches the backend after.
	await page.getByRole("button", { name: "Remove one.png" }).click()
	await expect(previews(page)).toHaveCount(1)
	await expect.poll(() => requestsTo(backend, "DELETE", "/run/run-one/files").map(request => request.path)).toEqual(["/run/run-one/files/a1"])
	await expect(replyBox(page)).toBeFocused()

	await input.setInputFiles(imageFile("huge.png", Buffer.alloc(10 * 1024 * 1024 + 1)))
	await expect(toast(page, "Attachments")).toContainText("huge.png: Files must be 10 MiB or smaller.")
	await input.setInputFiles(["a", "b", "c", "d"].map(name => imageFile(`${name}.png`)))
	await expect(toast(page, "Attachments")).toContainText("You can attach up to four files.")
	await expect(previews(page)).toHaveCount(1)

	await page.getByRole("button", { name: "Clear reply" }).click()
	await expect(previews(page)).toHaveCount(0)
	await expect.poll(() => requestsTo(backend, "DELETE", "/run/run-one/files").map(request => request.path).at(-1)).toBe("/run/run-one/files")
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
	await panel(page).getByLabel("Choose files").setInputFiles(imageFile("flaky.png"))
	await expect(panel(page).getByRole("status").filter({ hasText: "Update failed" })).toBeVisible()
	await expect(toast(page, "Attachments")).toContainText("API request failed (500): Storage unavailable")
	await expect(inlineAlerts(page)).toHaveCount(0)
	await expect(send(page)).toBeDisabled()

	await page.getByRole("button", { name: "Retry attachments" }).click()
	await expect(page.getByRole("button", { name: "Retry attachments" })).toHaveCount(0)
	await expect(send(page)).toBeEnabled()
	const uploads = requestsTo(backend, "POST", "/run/run-one/files")
	expect(uploads).toHaveLength(2)
	expect(new Set(uploads.map(upload => new URL(upload.path, "http://backend").searchParams.get("upload_id"))).size).toBe(1)
	expect(pending.map(item => item.name)).toEqual(["flaky.png"])
})

test("staged attachments load from the backend, with the renderer's origin, and survive switching views", async ({ desktop: { page }, backend }) => {
	stageImages(backend, [
		{ id: "a1", name: "earlier.png", path: ".robozium-attachments/a1.png", kind: "image", upload_id: null },
		{ id: "a2", name: "earlier.pdf", path: ".robozium-attachments/a2.pdf", kind: "file", upload_id: null },
	])
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
	await expect(previews(page)).toHaveCount(2)
	await expect(page.getByRole("img", { name: "earlier.pdf", exact: true })).toContainText("PDFearlier.pdf")
	expect(requestsTo(backend, "GET", "/run/run-one/files")).toHaveLength(1)
})

test("pasted and dropped files of any type show a labelled document tile and send", async ({ desktop: { page }, backend }) => {
	const pending = stageImages(backend)
	const replies: unknown[] = []
	backend.handlers.set("POST /run/run-one/reply", (response, body) => {
		replies.push(body)
		pending.length = 0
		json(response, { ok: true })
	})
	await openWaitingRun(page, backend)
	await transferFile(panel(page), "report.pdf", "paste", pdf, "application/pdf")
	await transferFile(replyBox(page), "budget.xlsx", "drop", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	await transferFile(panel(page), "notes", "paste", Buffer.from("plain text"), "")
	await expect(previews(page)).toHaveCount(3)
	await expect(page.getByRole("img", { name: "report.pdf", exact: true })).toContainText("PDFreport.pdf")
	await expect(page.getByRole("img", { name: "budget.xlsx", exact: true })).toContainText("XLSXbudget.xlsx")
	await expect(page.getByRole("img", { name: "notes", exact: true })).toContainText("FILEnotes")
	await expect(panel(page).locator("img")).toHaveCount(0)
	await expect(panel(page).getByRole("status")).toHaveCount(0)
	expect(requestsTo(backend, "POST", "/run/run-one/files").map(upload => upload.body)).toEqual([pdf, xlsx, Buffer.from("plain text")])

	await page.getByRole("button", { name: "Remove budget.xlsx" }).click()
	await expect(previews(page)).toHaveCount(2)
	await replyBox(page).fill("Summarise this")
	await replyBox(page).press("Enter")
	await expect(previews(page)).toHaveCount(0)
	expect(replies).toEqual([{ prompt_id: "p1", content: "Summarise this" }])
})

test("a pasted image the backend stores as a file turns into a document tile", async ({ desktop: { page }, backend }) => {
	stageImages(backend)
	await openWaitingRun(page, backend)
	await transferFile(panel(page), "fake.png", "paste", Buffer.from("not an image"))
	const tile = page.getByRole("img", { name: "fake.png", exact: true })
	await expect(tile).toContainText("PNGfake.png")
	await expect(panel(page).locator("img")).toHaveCount(0)
	await expect(panel(page).getByRole("status")).toHaveCount(0)
	await expect(send(page)).toBeEnabled()
})
