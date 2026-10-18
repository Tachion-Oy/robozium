import type { APIRequestContext, Locator, Page } from "@playwright/test"
import { writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import type { RunAttachment } from "../lib/robozium/wire"
import { PNG } from "pngjs"
import { expect, test } from "./fixtures"
import { createProject, selectHudView, e2eProjectPaths } from "./helpers"
import { waitForHudLayout } from "./hud-layout"

const preview = PNG.sync.write(new PNG({ width: 80, height: 40, fill: true }))
const imageFile = (name: string) => ({ name, mimeType: "image/png", buffer: preview })

async function openRun(page: Page, request: APIRequestContext, processing = false) {
	const slug = await createProject(request, `Image previews ${Date.now()}`)
	const hold = join(e2eProjectPaths(slug).root, ".mock-first-message-hold")
	if (processing) {
		await writeFile(join(e2eProjectPaths(slug).root, ".mock-scenario"), "held-first-message")
		await writeFile(hold, "")
	}
	const response = await request.post("/api/runs/create", { data: { project: slug } })
	expect(response.ok()).toBe(true)
	const { run_id: runId } = await response.json() as { run_id: string }
	await page.goto(`/?runId=${encodeURIComponent(runId)}`)
	if (processing) {
		await expect(page.getByRole("textbox", { name: "Reply text" })).toBeVisible()
		return { runId, slug, hold }
	}
	await expect(page.locator(".agent-hud__logo--actions")).toHaveAttribute("data-agent-state", "awaiting-input", { timeout: 20_000 })
	await waitForHudLayout(page)
	await page.getByRole("textbox", { name: "Reply text" }).fill("Keep this draft")
	await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled({ timeout: 20_000 })
	return { runId, slug, hold }
}

async function pending(request: APIRequestContext, runId: string): Promise<RunAttachment[]> {
	const response = await request.get(`/api/runs/${runId}/files`)
	expect(response.ok()).toBe(true)
	return await response.json() as RunAttachment[]
}

async function transferImage(target: Locator, name: string, event: "paste" | "drop" = "paste") {
	await target.evaluate((element, { bytes, name, event }) => {
		const data = new DataTransfer()
		data.items.add(new File([new Uint8Array(bytes)], name, { type: "image/png" }))
		if (event === "paste") {
			const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true })
			// Firefox discards clipboardData passed to the synthetic event constructor.
			Object.defineProperty(paste, "clipboardData", { value: data })
			element.dispatchEvent(paste)
		} else {
			element.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }))
		}
	}, { bytes: [...preview], name, event })
	await expect(target.page().getByRole("img", { name, exact: true })).toBeAttached()
}

test("picker, paste, and drop upload ordered images that survive navigation and refresh and submit without text", async ({ page, request }) => {
	test.setTimeout(90_000)
	const { runId } = await openRun(page, request)
	const editor = page.getByRole("textbox", { name: "Reply text" })
	const panel = page.getByRole("group", { name: "Reply composer" })
	const send = page.getByRole("button", { name: "Send", exact: true })
	const chooserPromise = page.waitForEvent("filechooser")
	await page.getByRole("button", { name: "image", exact: true }).click()
	await (await chooserPromise).setFiles(imageFile("picked.png"))
	await expect(page.getByRole("img", { name: "picked.png" })).toBeVisible()
	await transferImage(panel, "pasted.png")
	await transferImage(editor, "dropped.png", "drop")
	await transferImage(page.getByRole("button", { name: "Remove dropped.png" }), "fourth.png")
	await panel.locator("input[type=file]").setInputFiles(imageFile("excess.png"))
	await expect(panel.getByRole("alert")).toContainText("up to four images")
	await expect.poll(async () => (await pending(request, runId)).map(({ name }) => name)).toEqual(["picked.png", "pasted.png", "dropped.png", "fourth.png"])
	await expect(send).toBeEnabled()
	const urls = await panel.getByRole("img").evaluateAll((images) => images.map((image) => image.getAttribute("src")))
	await selectHudView(page, "Dependencies")
	await expect(editor).toHaveCount(0)
	await selectHudView(page, "Current Run")
	await expect(editor).toHaveValue("Keep this draft")
	expect(await panel.getByRole("img").evaluateAll((images) => images.map((image) => image.getAttribute("src")))).toEqual(urls)
	await page.getByRole("button", { name: "Minimize", exact: true }).click()
	await page.locator(".agent-hud__mini-expand").click()
	await expect(panel.getByRole("img")).toHaveCount(4)
	await page.reload()
	await expect(panel.getByRole("img")).toHaveCount(4)
	await expect(editor).toHaveValue("")
	await expect(send).toBeEnabled()
	await page.getByRole("button", { name: "Remove dropped.png" }).click()
	await expect.poll(async () => (await pending(request, runId)).map(({ name }) => name)).toEqual(["picked.png", "pasted.png", "fourth.png"])
	const submitted = await pending(request, runId)
	await page.route(`**/api/runs/${runId}/reply`, (route) => route.fulfill({ status: 400, json: { detail: "Rejected reply" } }), { times: 1 })
	await send.click()
	await expect(page.getByText("Reply failed", { exact: true })).toBeVisible()
	expect(await pending(request, runId)).toEqual(submitted)
	await expect(panel.getByRole("img")).toHaveCount(3)
	const replyPromise = page.waitForRequest((outgoing) => outgoing.method() === "POST" && outgoing.url().endsWith("/reply"))
	await editor.press("Enter")
	expect((await replyPromise).postDataJSON()).toEqual({ prompt_id: expect.any(String), content: "" })
	await expect(panel.getByRole("img")).toHaveCount(0)
	await expect.poll(() => pending(request, runId)).toEqual([])
	await expect(page.locator(".agent-hud__agent", { hasText: "Thanks. One more thing before I finish?" })).toBeVisible({ timeout: 30_000 })
	for (const item of submitted) expect((await request.get(`/api/files/${item.path}`)).status()).toBe(200)
	await transferImage(editor, "unsent.png")
	await expect(send).toBeEnabled()
	await editor.fill("Clear this text too")
	await page.getByRole("button", { name: "Clear reply" }).click()
	await expect(editor).toHaveValue("")
	await expect(panel.getByRole("img")).toHaveCount(0)
	await expect.poll(() => pending(request, runId)).toEqual([])
	for (const item of submitted) expect((await request.get(`/api/files/${item.path}`)).status()).toBe(200)
	await editor.fill("A text reply")
	await expect(send).toBeEnabled()
	const accepted = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/reply"))
	await send.click()
	expect((await accepted).ok()).toBe(true)
	await expect.poll(async () => (await (await request.get(`/api/runs/${runId}/view`)).json()).status).toBe("completed")
	for (const item of submitted) {
		await expect.poll(async () => (await request.get(`/api/files/${item.path}`)).status(), { timeout: 20_000 }).toBe(404)
	}
})

test("reopening a run during upload waits and restores its pending image", async ({ page, request }) => {
	const { runId, slug } = await openRun(page, request)
	const other = await createProject(request, `Other image run ${Date.now()}`)
	const created = await request.post("/api/runs/create", { data: { project: other } })
	expect(created.ok()).toBe(true)
	const { run_id: otherRunId } = await created.json() as { run_id: string }
	let release!: () => void
	const gate = new Promise<void>((resolve) => { release = resolve })
	let uploading = false
	await page.route(`**/api/runs/${runId}/files**`, async (route) => {
		if (route.request().method() === "POST") { uploading = true; await gate }
		await route.continue()
	})
	try {
		await page.getByLabel("Choose images").setInputFiles(imageFile("in-flight.png"))
		await expect.poll(() => uploading).toBe(true)
		await selectHudView(page, "Runs Overview")
		await page.getByRole("button", { name: `Open ${other}`, exact: true }).click()
		await expect(page).toHaveURL(`/?runId=${otherRunId}`)
		await expect(page.getByRole("textbox", { name: "Reply text" })).toBeVisible()
		await selectHudView(page, "Runs Overview")
		await page.getByRole("button", { name: `Open ${slug}`, exact: true }).click()
		await expect(page).toHaveURL(`/?runId=${runId}`)
		await page.getByRole("textbox", { name: "Reply text" }).fill("Wait for the image")
		await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled()
		expect(await pending(request, runId)).toEqual([])
		release()
		await expect(page.getByRole("img", { name: "in-flight.png", exact: true })).toBeVisible()
		await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled()
		expect(await pending(request, runId)).toHaveLength(1)
	} finally { release() }
})

for (const action of ["Clear", "Remove"] as const) {
	test(`${action} during upload waits, discards queued images, and leaves no server files`, async ({ page, request }) => {
		const { runId } = await openRun(page, request)
		let release!: () => void
		const gate = new Promise<void>((resolve) => { release = resolve })
		let uploads = 0
		let deletions = 0
		await page.route(`**/api/runs/${runId}/files**`, async (route) => {
			if (route.request().method() === "POST") { uploads += 1; await gate }
			if (route.request().method() === "DELETE") deletions += 1
			await route.continue()
		})
		try {
			const panel = page.getByRole("group", { name: "Reply composer" })
			const editor = page.getByRole("textbox", { name: "Reply text" })
			await panel.locator("input[type=file]").setInputFiles([imageFile("active.png"), imageFile("queued.png")])
			await expect.poll(() => uploads).toBe(1)
			await expect(panel.getByRole("img")).toHaveCount(2)
			await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled()
			await editor.press("Enter")
			await panel.evaluate((element) => element.closest("form")!.requestSubmit())
			await expect(editor).toHaveValue("Keep this draft")
			if (action === "Clear") await page.getByRole("button", { name: "Clear reply" }).click()
			else {
				await page.getByRole("button", { name: "Remove active.png" }).click()
				await page.getByRole("button", { name: "Remove queued.png" }).click()
			}
			await expect(panel.getByRole("img")).toHaveCount(0)
			expect(deletions).toBe(0)
			release()
			await expect.poll(() => deletions).toBeGreaterThan(0)
			await editor.fill("Ready after deletion")
			await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled()
			expect(await pending(request, runId)).toEqual([])
			expect(uploads).toBe(1)
			await page.reload()
			await expect(editor).toBeVisible()
			await expect(panel.getByRole("img")).toHaveCount(0)
		} finally { release() }
	})
}

test("uploads while processing survive the next prompt and cancellation cleans pending files", async ({ page, request }) => {
	const { runId, slug, hold } = await openRun(page, request, true)
	try {
		const editor = page.getByRole("textbox", { name: "Reply text" })
		await transferImage(editor, "processing.png")
		await expect.poll(async () => (await pending(request, runId)).length).toBe(1)
		const [attachment] = await pending(request, runId)
		await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled()
		await rm(hold, { force: true })
		await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled({ timeout: 20_000 })
		expect(await pending(request, runId)).toEqual([attachment])
		await page.getByRole("button", { name: "Cancel", exact: true }).click()
		await expect.poll(() => pending(request, runId)).toEqual([])
		await expect.poll(async () => (await request.get(`/api/files/${attachment.path}`)).status()).toBe(404)
		expect((await request.post(`/api/runs/${runId}/files?filename=late.png`, { data: preview })).status()).toBe(400)
		expect((await request.post(`/api/projects/${slug}/cancel`)).ok()).toBe(true)
	} finally { await rm(hold, { force: true }) }
})

test("previews keep panel bounds, compact size, selection, and independent scrolling in every layout", async ({ page, request }, testInfo) => {
	test.setTimeout(180_000)
	await page.emulateMedia({ reducedMotion: "reduce" })
	await openRun(page, request)
	const panel = page.getByRole("group", { name: "Reply composer" })
	const editor = page.getByRole("textbox", { name: "Reply text" })
	const input = panel.locator("input[type=file]")
	const longDraft = Array.from({ length: 80 }, (_, i) => `Line ${i}: a long reply that wraps within the remaining text area.`).join("\n")
	const up = page.getByRole("button", { name: "Move panel divider up" })
	const down = page.getByRole("button", { name: "Move panel divider down" })
	for (const theme of ["dark", "light"]) {
		await page.evaluate((theme) => { document.documentElement.dataset.theme = theme }, theme)
		for (const viewport of [{ width: 1280, height: 900 }, { width: 720, height: 900 }]) {
			await page.setViewportSize(viewport)
			for (const size of ["Home", "End"]) {
				await page.getByRole("slider", { name: "Resize HUD" }).focus()
				await page.keyboard.press(size)
				while (await down.isEnabled()) await down.click()
				let compactThumbnail = 0
				for (const layout of ["top", "equal", "bottom"]) {
					if (layout !== "top") await up.click()
					await waitForHudLayout(page, [".agent-hud__replyBox--user"])
					await expect(panel.locator("input[type=file]")).toBeEnabled()
					await page.getByRole("button", { name: "image", exact: true }).click({ trial: true })
					const controls = await page.locator(".agent-hud__actions").evaluate((element) => {
						const image = element.querySelector<HTMLElement>(".agent-hud__image")!
						const record = element.querySelector<HTMLElement>(".agent-hud__dictate")!
						const groups = [...element.children].map((group) => group.getBoundingClientRect())
						const imageBounds = image.getBoundingClientRect()
						const recordBounds = record.getBoundingClientRect()
						return {
							adjacent: image.nextElementSibling === record && Math.abs(imageBounds.top - recordBounds.top) < 1 && imageBounds.right < recordBounds.left,
							sameStyle: getComputedStyle(image).getPropertyValue("--btn-accent") === getComputedStyle(record).getPropertyValue("--btn-accent") && getComputedStyle(image).borderRadius === getComputedStyle(record).borderRadius,
							separateGroups: groups.every((a, i) => groups.every((b, j) => i === j || a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1)),
						}
					})
					expect(controls).toEqual({ adjacent: true, sameStyle: true, separateGroups: true })
					await editor.fill(longDraft)
					const before = await panel.boundingBox()
					const fullTextWidth = await editor.evaluate((element) => element.clientWidth)
					await editor.evaluate((element: HTMLTextAreaElement) => {
						element.focus()
						element.setSelectionRange(5, 12, "backward")
						element.scrollTop = element.scrollHeight
					})
					await transferImage(editor, "first.png")
					await waitForHudLayout(page, [".agent-hud__replyBox--user", ".agent-hud__reply-images"])
					expect(await panel.boundingBox()).toEqual(before)
					await expect(editor).toHaveValue(longDraft)
					expect(await editor.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd, element.selectionDirection, element.scrollTop])).toEqual([5, 12, "backward", 0])
					const frame = page.locator(".agent-hud__reply-image").first()
					const frameBounds = (await frame.boundingBox())!
					expect(frameBounds.width).toBeCloseTo(frameBounds.height, 0)
					if (layout === "top") compactThumbnail = frameBounds.height
					else expect(frameBounds.height).toBeCloseTo(compactThumbnail, 0)
					const list = panel.getByRole("list", { name: "Image previews" })
					const inset = await list.evaluate((element) => {
						const bounds = element.getBoundingClientRect()
						const first = element.firstElementChild!.getBoundingClientRect()
						return { padding: first.left - bounds.left, rem: Number.parseFloat(getComputedStyle(document.documentElement).fontSize) }
					})
					expect(inset.padding).toBeGreaterThanOrEqual(inset.rem)
					expect(frameBounds.height).toBeLessThanOrEqual(await list.evaluate((element) => element.clientHeight) + 1)
					await expect(panel.getByRole("img")).toHaveCSS("object-fit", "contain")
					await expect.poll(() => panel.getByRole("img").evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth / element.naturalHeight === 2)).toBe(true)
					await input.setInputFiles([imageFile("second.png"), imageFile("third.png"), imageFile("newest.png")])
					await expect(panel.getByRole("img")).toHaveCount(4)
					const scrolling = await panel.evaluate((element) => {
						const text = element.querySelector("textarea")!
						const list = element.querySelector<HTMLElement>("ul")!
						const frames = [...list.children].map((child) => child.getBoundingClientRect())
						const listBounds = list.getBoundingClientRect()
						const newestVisible = frames[3].bottom <= listBounds.bottom + 1 && frames[3].top >= listBounds.top - 1
						const stacked = frames.every((frame, i) => i === 0 || frame.top > frames[i - 1].bottom)
						const imageScroll = list.scrollTop
						text.scrollTop = text.scrollHeight
						const independentText = text.scrollTop > 0 && list.scrollTop === imageScroll
						const textScroll = text.scrollTop
						list.scrollTop = 0
						const followingImage = list.children[1].getBoundingClientRect()
						return { newestVisible, stacked, independentText, independentImages: text.scrollTop === textScroll, moreVisible: followingImage.top < listBounds.bottom - 1, textWidth: text.clientWidth, overflow: document.documentElement.scrollWidth > innerWidth }
					})
					expect(scrolling).toMatchObject({ newestVisible: true, stacked: true, independentText: true, independentImages: true, moreVisible: true, overflow: false })
					expect(scrolling.textWidth).toBeLessThan(fullTextWidth)
					const textWidth = await editor.evaluate((element) => element.clientWidth)
					await editor.hover()
					expect(await editor.evaluate((element) => element.clientWidth)).toBe(textWidth)
					await list.focus()
					expect(await editor.evaluate((element) => element.clientWidth)).toBe(textWidth)
					if (viewport.width === 1280 && size === "Home" && layout === "top") {
						await page.locator(".agent-hud__box").screenshot({ path: testInfo.outputPath(`image-composer-${theme}.png`), animations: "disabled", caret: "hide" })
					}
					await list.evaluate((element) => { element.scrollTop = element.scrollHeight })
					await page.getByRole("button", { name: "Remove newest.png" }).click()
					await expect(panel.getByRole("img")).toHaveCount(3)
					await page.getByRole("button", { name: "Clear reply" }).click()
					await expect(list).toHaveCount(0)
					expect(await editor.evaluate((element) => element.clientWidth)).toBe(fullTextWidth)
					expect(await panel.boundingBox()).toEqual(before)
				}
			}
		}
	}
})
