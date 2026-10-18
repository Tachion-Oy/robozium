import type { APIRequestContext, Locator, Page } from "@playwright/test"
import { PNG } from "pngjs"
import { expect, test } from "./fixtures"
import { createProject, selectHudView } from "./helpers"
import { waitForHudLayout } from "./hud-layout"

const preview = PNG.sync.write(new PNG({ width: 80, height: 40, fill: true }))
const imageFile = (name: string) => ({ name, mimeType: "image/png", buffer: preview })

async function openRun(page: Page, request: APIRequestContext) {
	const slug = await createProject(request, `Image previews ${Date.now()}`)
	const response = await request.post("/api/runs/create", { data: { project: slug } })
	expect(response.ok()).toBe(true)
	const { run_id: runId } = await response.json() as { run_id: string }
	await page.goto(`/?runId=${encodeURIComponent(runId)}`)
	await expect(page.locator(".agent-hud__logo--actions")).toHaveAttribute("data-agent-state", "awaiting-input", { timeout: 20_000 })
	await waitForHudLayout(page)
	await page.getByRole("textbox", { name: "Reply text" }).fill("Keep this draft")
	await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled({ timeout: 20_000 })
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

test("image drafts survive HUD navigation and block every submission path without uploads", async ({ page, request }) => {
	test.setTimeout(90_000)
	await openRun(page, request)
	const mutations: string[] = []
	page.on("request", (outgoing) => {
		if (outgoing.method() !== "GET") mutations.push(outgoing.url())
	})
	const editor = page.getByRole("textbox", { name: "Reply text" })
	const panel = page.getByRole("group", { name: "Reply composer" })
	const input = panel.locator("input[type=file]")
	const chooserPromise = page.waitForEvent("filechooser")
	await page.getByRole("button", { name: "image", exact: true }).click()
	await (await chooserPromise).setFiles(imageFile("picked.png"))
	await expect(page.getByRole("img", { name: "picked.png" })).toBeVisible()
	await transferImage(panel, "pasted.png")
	await transferImage(editor, "dropped.png", "drop")
	await transferImage(page.getByRole("button", { name: "Remove dropped.png" }), "fourth.png")
	await input.setInputFiles(imageFile("excess.png"))
	await expect(panel.getByRole("alert")).toContainText("up to four images")
	await expect(panel.getByRole("img")).toHaveCount(4)
	const urls = await panel.getByRole("img").evaluateAll((images) => images.map((image) => image.getAttribute("src")))
	await selectHudView(page, "Dependencies")
	await expect(editor).toHaveCount(0)
	await selectHudView(page, "Current Run")
	await expect(editor).toHaveValue("Keep this draft")
	expect(await panel.getByRole("img").evaluateAll((images) => images.map((image) => image.getAttribute("src")))).toEqual(urls)
	await page.getByRole("button", { name: "Minimize", exact: true }).click()
	await page.locator(".agent-hud__mini-expand").click()
	await expect(editor).toHaveValue("Keep this draft")
	await expect(panel.getByRole("img")).toHaveCount(4)
	await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled()
	await expect(panel).toContainText("Images can be previewed but not sent yet.")
	await editor.press("Enter")
	await panel.evaluate((element) => element.closest("form")!.requestSubmit())
	await expect(editor).toHaveValue("Keep this draft")
	expect(mutations).toEqual([])
	await page.getByRole("button", { name: "Clear reply" }).click()
	await expect(editor).toHaveValue("")
	await expect(panel.getByRole("img")).toHaveCount(0)
	await transferImage(editor, "image-only.png")
	await page.getByRole("button", { name: "Clear reply" }).click()
	await expect(panel.getByRole("img")).toHaveCount(0)
	await editor.fill("A text reply")
	await transferImage(editor, "last.png")
	await page.getByRole("button", { name: "Remove last.png" }).click()
	await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled()
	expect(mutations).toEqual([])
	const replyPromise = page.waitForRequest((outgoing) => outgoing.method() === "POST" && outgoing.url().endsWith("/reply"))
	await editor.press("Enter")
	const reply = await replyPromise
	expect(reply.postDataJSON()).toEqual({ prompt_id: expect.any(String), content: "A text reply" })
	await expect(editor).toHaveValue("")
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
