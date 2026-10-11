import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, test } from "./fixtures"
import { createProject, e2eProjectPaths } from "./helpers"
import { waitForHudLayout } from "./hud-layout"

test("wraps HUD tables while keeping wide columns readable", async ({ page, request }) => {
	test.setTimeout(90_000)
	const slug = await createProject(request, `Table Wrapping E2E ${Date.now()}`)
	const { root } = e2eProjectPaths(slug)
	await mkdir(root, { recursive: true })
	await writeFile(join(root, ".mock-scenario"), "user-notification", "utf-8")
	const response = await request.post("/api/runs/create", { data: { project: slug } })
	expect(response.ok()).toBeTruthy()
	const { run_id: runId } = await response.json() as { run_id: string }
	await page.goto(`/?runId=${encodeURIComponent(runId)}`)
	await expect(page.locator(".agent-hud__agent")).toContainText(
		"Hello! I generated a text artifact", { timeout: 30_000 },
	)
	await page.getByRole("button", { name: "Previous agent message" }).click()
	await expect(page.getByRole("heading", { name: "Generated artifacts" })).toBeVisible()

	const ordinary = page.locator(".agent-hud__markdown-table-scroll", {
		has: page.getByRole("columnheader", { name: "Work item", exact: true }),
	})
	const wide = page.locator(".agent-hud__markdown-table-scroll", {
		has: page.getByRole("columnheader", { name: "Date", exact: true }),
	})
	for (const theme of ["dark", "light"] as const) {
		await page.evaluate((theme) => { document.documentElement.dataset.theme = theme }, theme)
		await page.setViewportSize({ width: 720, height: 900 })
		await waitForHudLayout(page, [".agent-hud__replyBox--agent"])
		const compact = await ordinary.evaluate((scroller) => {
			const table = scroller.querySelector("table")!
			const header = table.querySelector("th:last-child")!
			const description = table.querySelector("tbody tr:first-child td:last-child")!
			const link = table.querySelector("a")!
			const code = table.querySelector("code")!
			const lineCount = (element: Element) => {
				const range = document.createRange()
				range.selectNodeContents(element)
				return new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top))).size
			}
			return {
				clientWidth: scroller.clientWidth,
				scrollWidth: scroller.scrollWidth,
				tableWidth: table.getBoundingClientRect().width,
				headerLines: lineCount(header),
				descriptionLines: lineCount(description),
				linkLines: lineCount(link),
				codeLines: lineCount(code),
				cellOverflow: Math.max(...Array.from(table.querySelectorAll("th, td"),
					(cell) => cell.scrollWidth - cell.clientWidth)),
				numericAlignment: getComputedStyle(table.querySelector("td:nth-child(2)")!).textAlign,
			}
		})
		expect(compact.scrollWidth).toBeLessThanOrEqual(compact.clientWidth + 1)
		expect(compact.tableWidth).toBeLessThanOrEqual(compact.clientWidth + 1)
		expect(compact.headerLines).toBeGreaterThan(1)
		expect(compact.descriptionLines).toBeGreaterThan(1)
		expect(compact.linkLines).toBeGreaterThan(1)
		expect(compact.codeLines).toBeGreaterThan(1)
		expect(compact.cellOverflow).toBeLessThanOrEqual(1)
		expect(compact.numericAlignment).toBe("right")

		const narrowWideTable = await wide.evaluate((scroller) => {
			const table = scroller.querySelector("table")!
			const cells = Array.from(table.querySelectorAll("th, td"))
			const style = getComputedStyle(cells[0])
			const context = document.createElement("canvas").getContext("2d")!
			context.font = `${style.fontSize} ${style.fontFamily}`
			return {
				clientWidth: scroller.clientWidth,
				scrollWidth: scroller.scrollWidth,
				minimumWidth: Math.min(...cells.map((cell) => cell.getBoundingClientRect().width)),
				tenCharacters: context.measureText("0000000000").width,
			}
		})
		expect(narrowWideTable.scrollWidth).toBeGreaterThan(narrowWideTable.clientWidth)
		expect(narrowWideTable.minimumWidth).toBeGreaterThanOrEqual(narrowWideTable.tenCharacters - 1)

		await page.setViewportSize({ width: 1920, height: 1080 })
		const resize = page.getByRole("slider", { name: "Resize HUD" })
		await resize.focus()
		await page.keyboard.press("End")
		await waitForHudLayout(page, [".agent-hud__replyBox--agent"])
		const expanded = await wide.evaluate((scroller) => ({
			clientWidth: scroller.clientWidth,
			scrollWidth: scroller.scrollWidth,
		}))
		expect(expanded.clientWidth).toBeGreaterThan(narrowWideTable.clientWidth)
		expect(expanded.scrollWidth).toBeLessThanOrEqual(expanded.clientWidth + 1)
	}
})
