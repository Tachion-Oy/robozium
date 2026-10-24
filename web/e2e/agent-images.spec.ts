import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { APIRequestContext, Page } from "@playwright/test"
import { PNG } from "pngjs"
import { expect, test } from "./fixtures"
import { createProject, e2eProjectPaths, selectHudView } from "./helpers"
import { waitForHudLayout } from "./hud-layout"

test.use({ actionTimeout: 15_000 })

function picture(width: number, height: number) {
	const png = new PNG({ width, height })
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const offset = (y * width + x) * 4
			png.data.set([Math.round(255 * x / width), Math.round(255 * y / height), 150, 255], offset)
		}
	}
	return PNG.sync.write(png)
}

const landscape = picture(1200, 600)
const portrait = picture(300, 900)

async function openImages(page: Page, request: APIRequestContext) {
	const slug = await createProject(request, `Agent images ${Date.now()}`)
	const root = e2eProjectPaths(slug).root
	await mkdir(join(root, "images"), { recursive: true })
	await writeFile(join(root, "images", "landscape ü.png"), landscape)
	await writeFile(join(root, "images", "portrait.png"), portrait)
	await writeFile(join(root, ".mock-scenario"), "inline-images")
	await page.route("https://images.example.test/reference.png", (route) => route.fulfill({ contentType: "image/png", body: landscape }))
	const response = await request.post("/api/runs/create", { data: { project: slug } })
	expect(response.ok()).toBe(true)
	const { run_id: runId } = await response.json() as { run_id: string }
	await page.goto(`/?runId=${encodeURIComponent(runId)}`)
	await expect(page.getByRole("heading", { name: "Image previews" })).toBeVisible({ timeout: 20_000 })
	await waitForHudLayout(page)
	return { runId, slug }
}

test("agent images expand accessibly, survive history and refresh, and retain original links", async ({ page, request }) => {
	test.setTimeout(90_000)
	const errors: string[] = []
	let reloading = false
	page.on("pageerror", (error) => {
		// WebKit reports the run poll that a reload cancels as an access-control failure.
		if (reloading && /due to access control checks/.test(error.message)) return
		errors.push(error.message)
	})
	const { runId, slug } = await openImages(page, request)
	const panel = page.locator(".agent-hud__replyBox--agent")
	const trigger = panel.getByRole("button", { name: "Expand Landscape" })
	for (const name of ["Landscape", "Portrait", "Web reference"]) {
		const image = panel.getByRole("img", { name, exact: true })
		await image.scrollIntoViewIfNeeded()
		await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)
	}
	await expect(panel.getByRole("status")).toContainText("Missing image — Image unavailable")
	await expect(panel.getByRole("link", { name: "Open the generated text file" })).toHaveAttribute("href", `/api/files/projects/${slug}/documents/generated-note.txt`)
	await trigger.focus()
	await page.keyboard.press("Enter")
	const dialog = page.getByRole("dialog", { name: "Landscape" })
	await expect(dialog).toBeVisible()
	await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused()
	await page.keyboard.press("Tab")
	expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
	await page.keyboard.press("Shift+Tab")
	expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
	await page.keyboard.press("Escape")
	await expect(dialog).toHaveCount(0)
	await expect(trigger).toBeFocused()
	await expect(panel).toBeVisible()
	await expect(page.locator(".agent-hud--hidden")).toHaveCount(0)
	await page.keyboard.press("Space")
	await expect(dialog).toBeVisible()
	const popupPromise = page.waitForEvent("popup")
	await dialog.getByRole("link", { name: "Open original" }).click()
	const popup = await popupPromise
	await expect(popup).toHaveURL(new RegExp(`/api/files/projects/${slug}/images/landscape%20%C3%BC.png$`))
	await popup.close()
	await page.bringToFront()
	await dialog.getByRole("button", { name: "Close", exact: true }).click()
	await trigger.click()
	await page.mouse.click(2, 2)
	await expect(dialog).toHaveCount(0)
	await expect(trigger).toBeFocused()
	await trigger.click()
	reloading = true
	await page.reload()
	await expect(dialog).toHaveCount(0)
	await expect(trigger).toBeVisible()
	reloading = false
	const editor = page.getByRole("textbox", { name: "Reply text" })
	await editor.fill("Continue")
	await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled()
	await editor.press("Enter")
	await expect(panel).toContainText("Thanks. One more thing before I finish?", { timeout: 20_000 })
	await page.getByRole("button", { name: "Jump to first agent message" }).click()
	await expect(trigger).toBeVisible()
	await trigger.click()
	await expect(dialog).toBeVisible()
	await dialog.getByRole("button", { name: "Close", exact: true }).click()
	await selectHudView(page, "Dependencies")
	await expect(dialog).toHaveCount(0)
	await selectHudView(page, "Current Run")
	await page.getByRole("button", { name: "Jump to latest agent message" }).click()
	await editor.fill("Finish")
	await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled()
	await editor.press("Enter")
	await expect.poll(async () => (await (await request.get(`/api/runs/${runId}/view`)).json()).status).toBe("completed")
	expect((await request.get(`/api/files/projects/${slug}/images/landscape%20%C3%BC.png`)).status()).toBe(200)
	expect(errors).toEqual([])
})

test("delayed images preserve reading position and fit each panel layout and theme", async ({ page, request }, testInfo) => {
	test.setTimeout(120_000)
	await page.emulateMedia({ reducedMotion: "reduce" })
	let release!: () => void
	const gate = new Promise<void>((resolve) => { release = resolve })
	await page.route("**/api/files/**/portrait.png", async (route) => { await gate; await route.continue() })
	try {
		await openImages(page, request)
		const scroller = page.locator(".agent-hud__replyBox--agent .agent-hud__replyBox-scroll")
		await expect(page.getByRole("button", { name: "Expand Portrait" })).toHaveAttribute("aria-busy", "true")
		await expect(page.locator(".agent-hud__logo--actions")).toHaveAttribute("data-agent-state", "awaiting-input")
		await scroller.evaluate((element) => { element.scrollTop = 20 })
		await page.getByRole("button", { name: "Expand Portrait" }).click()
		const loadingDialog = page.getByRole("dialog", { name: "Portrait" })
		await expect(loadingDialog).toBeVisible()
		const original = loadingDialog.getByRole("link", { name: "Open original" })
		const before = await original.boundingBox()
		const scrollTop = await scroller.evaluate((element) => element.scrollTop)
		release()
		await expect.poll(() => loadingDialog.getByRole("img").evaluate((image: HTMLImageElement) => image.naturalHeight)).toBe(900)
		const after = await original.boundingBox()
		expect(Math.abs(after!.x - before!.x)).toBeLessThan(1)
		expect(Math.abs(after!.y - before!.y)).toBeLessThan(1)
		await page.keyboard.press("Escape")
		await expect(loadingDialog).toHaveCount(0)
		await expect(page.getByRole("button", { name: "Expand Portrait" })).toHaveAttribute("aria-busy", "false")
		expect(await scroller.evaluate((element) => element.scrollTop)).toBe(scrollTop)
		for (const theme of ["dark", "light"]) {
			await page.evaluate((theme) => { document.documentElement.dataset.theme = theme }, theme)
			for (const viewport of [{ width: 1280, height: 900 }, { width: 640, height: 700 }]) {
				await page.setViewportSize(viewport)
				const down = page.getByRole("button", { name: "Move panel divider down" })
				while (await down.isEnabled()) await down.click()
				for (const layout of ["top", "equal", "bottom"]) {
					if (layout !== "top") await page.getByRole("button", { name: "Move panel divider up" }).click()
					await waitForHudLayout(page, [".agent-hud__replyBox--agent"])
					const geometry = await scroller.evaluate((element) => ({
						width: element.clientWidth, scrollWidth: element.scrollWidth,
						images: [...element.querySelectorAll(".agent-hud__image-preview img")].map((image) => {
							const rect = image.getBoundingClientRect()
							return { width: rect.width, height: rect.height }
						}),
					}))
					expect(geometry.scrollWidth).toBe(geometry.width)
					for (const image of geometry.images) {
						expect(image.width).toBeLessThanOrEqual(Math.min(360, geometry.width))
						expect(image.height).toBeLessThanOrEqual(240)
					}
					await page.getByRole("button", { name: "Expand Landscape" }).click()
					const dialog = page.getByRole("dialog")
					await expect(dialog).toBeVisible()
					const bounds = await dialog.boundingBox()
					expect(bounds!.x).toBeGreaterThanOrEqual(0)
					expect(bounds!.y).toBeGreaterThanOrEqual(0)
					expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width)
					expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height)
					expect(Math.abs(bounds!.y + bounds!.height / 2 - viewport.height / 2)).toBeLessThan(2)
					if (layout === "equal" && viewport.width === 640) {
						await page.screenshot({ path: testInfo.outputPath(`image-viewer-${theme}.png`) })
					}
					await page.keyboard.press("Escape")
					await expect(dialog).toHaveCount(0)
					await expect(page.locator(".agent-hud--hidden")).toHaveCount(0)
				}
			}
		}
	} finally { release() }
})
