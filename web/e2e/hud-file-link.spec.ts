import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, test } from "./fixtures"
import { createProject, e2eProjectPaths } from "./helpers"

test("follows the newest HUD message while preserving selected history", async ({
	browserName,
	page,
	request,
}) => {
	test.setTimeout(60_000)
	const projectSlug = await createProject(
		request,
		`Notification Links E2E ${Date.now()}`,
	)
	const { root: projectRoot } = e2eProjectPaths(projectSlug)
	await mkdir(projectRoot, { recursive: true })
	await writeFile(join(projectRoot, ".mock-scenario"), "user-notification", "utf-8")

	const relativePath = `projects/${projectSlug}/documents/generated-note.txt`
	const artifactPath = join(projectRoot, "documents", "generated-note.txt")
	const artifactBody = "Generated during Playwright E2E link test."
	await mkdir(join(projectRoot, "documents"), { recursive: true })
	await writeFile(artifactPath, artifactBody, "utf-8")

	const createResponse = await request.post("/api/runs/create", {
		data: { project: projectSlug },
	})
	expect(createResponse.ok()).toBeTruthy()
	const payload = (await createResponse.json()) as { run_id?: unknown }
	expect(typeof payload.run_id).toBe("string")

	await page.goto(`/?runId=${encodeURIComponent(payload.run_id as string)}`)

	const notificationHeading = page.getByRole("heading", {
		name: "Generated artifacts",
	})
	const agentMessage = page.locator(".agent-hud__agent")
	await expect(agentMessage).toContainText(
		"Hello! I generated a text artifact",
		{ timeout: 30_000 },
	)
	await page
		.getByRole("button", { name: "Previous agent message" })
		.click()
	await expect(notificationHeading).toBeVisible()
	const prose = page.locator(".agent-hud__markdown-p", {
		hasText: "Plain prose:",
	})
	const codeScroller = page.locator(".agent-hud__markdown-pre")
	await expect(prose).toContainText("Fullstack-kehittäjä · 75–85 €/h")
	await expect(codeScroller).toContainText("Literal escape: \\ud83d\\ude80")

	const contentGeometry = await prose.evaluate((paragraph) => {
		const outer = paragraph.closest<HTMLElement>(
			".agent-hud__replyBox-scroll",
		)!
		const code = outer.querySelector<HTMLElement>(
			".agent-hud__markdown-pre",
		)!
		const outerRect = outer.getBoundingClientRect()
		const paragraphRect = paragraph.getBoundingClientRect()
		const codeRect = code.getBoundingClientRect()
		return {
			outerClientWidth: outer.clientWidth,
			outerScrollWidth: outer.scrollWidth,
			outerOverflowX: getComputedStyle(outer).overflowX,
			paragraphClientWidth: paragraph.clientWidth,
			paragraphScrollWidth: paragraph.scrollWidth,
			paragraphOverflowWrap: getComputedStyle(paragraph).overflowWrap,
			paragraphContained:
				paragraphRect.left >= outerRect.left - 1 &&
				paragraphRect.right <= outerRect.right + 1,
			codeClientWidth: code.clientWidth,
			codeScrollWidth: code.scrollWidth,
			codeOverflowX: getComputedStyle(code).overflowX,
			codeWhiteSpace: getComputedStyle(code).whiteSpace,
			codeContained:
				codeRect.left >= outerRect.left - 1 &&
				codeRect.right <= outerRect.right + 1,
		}
	})
	expect(contentGeometry.outerScrollWidth).toBe(
		contentGeometry.outerClientWidth,
	)
	expect(contentGeometry.outerOverflowX).toBe("hidden")
	expect(contentGeometry.paragraphScrollWidth).toBe(
		contentGeometry.paragraphClientWidth,
	)
	expect(contentGeometry.paragraphOverflowWrap).toBe("anywhere")
	expect(contentGeometry.paragraphContained).toBe(true)
	expect(contentGeometry.codeScrollWidth).toBeGreaterThan(
		contentGeometry.codeClientWidth,
	)
	expect(contentGeometry.codeOverflowX).toBe("auto")
	expect(contentGeometry.codeWhiteSpace).toBe("pre")
	expect(contentGeometry.codeContained).toBe(true)

	const tableGeometry = await page
		.locator(".agent-hud__markdown-table-scroll")
		.evaluate((scroller) => {
			const table = scroller.querySelector("table")!
			const firstHeader = table.querySelector("th")!
			const explanation = table.querySelector("td:last-child")!
			return {
				scrollWidth: scroller.scrollWidth,
				clientWidth: scroller.clientWidth,
				tableWidth: table.getBoundingClientRect().width,
				paddingBottom: Number.parseFloat(
					getComputedStyle(scroller).paddingBottom,
				),
				scrollbarWidth: getComputedStyle(scroller).scrollbarWidth,
				scrollbarColor: getComputedStyle(scroller).scrollbarColor,
				headerWhiteSpace: getComputedStyle(firstHeader).whiteSpace,
				headerWordBreak: getComputedStyle(firstHeader).wordBreak,
				explanationWhiteSpace: getComputedStyle(explanation).whiteSpace,
			}
		})
	expect(tableGeometry.scrollWidth).toBeGreaterThan(tableGeometry.clientWidth)
	expect(tableGeometry.tableWidth).toBeGreaterThan(tableGeometry.clientWidth)
	expect(tableGeometry.paddingBottom).toBeGreaterThan(0)
	// Headless Firefox suppresses native scrollbars and reports `none` here.
	// The regression value is `thin`, which produced the near-impossible target.
	expect(tableGeometry.scrollbarWidth).not.toBe("thin")
	expect(tableGeometry.scrollbarColor).not.toBe("auto")
	expect(tableGeometry.headerWhiteSpace).toBe("nowrap")
	expect(tableGeometry.headerWordBreak).toBe("normal")
	expect(tableGeometry.explanationWhiteSpace).toBe("normal")

	const tableScroller = page.locator(".agent-hud__markdown-table-scroll")
	const agentScroller = page.locator(
		".agent-hud__replyBox--agent .agent-hud__replyBox-scroll",
	)
	if (browserName === "webkit") {
		// Headless WebKit does not dispatch Playwright's horizontal wheel delta.
		await tableScroller.evaluate((scroller) => scroller.scrollBy(500, 0))
	} else {
		await tableScroller.hover()
		await page.mouse.wheel(500, 0)
	}
	await expect
		.poll(() => tableScroller.evaluate((scroller) => scroller.scrollLeft))
		.toBeGreaterThan(0)
	const moveDividerUp = page.getByRole("button", {
		name: "Move panel divider up",
	})
	await moveDividerUp.click()
	await moveDividerUp.click()
	await expect(
		page.getByRole("group", { name: "Panel divider: bottom" }),
	).toBeVisible()
	await expect
		.poll(() => tableScroller.evaluate((scroller) => scroller.scrollLeft))
		.toBeGreaterThan(0)
	await expect
		.poll(() =>
			agentScroller.evaluate(
				(scroller) => scroller.scrollHeight > scroller.clientHeight,
			),
		)
		.toBe(true)

	const agentScrollGeometry = await agentScroller.evaluate((scroller) => {
		const style = getComputedStyle(scroller)
		return {
			scrollHeight: scroller.scrollHeight,
			clientHeight: scroller.clientHeight,
			marginTop: Number.parseFloat(style.marginTop),
			marginBottom: Number.parseFloat(style.marginBottom),
			paddingRight: Number.parseFloat(style.paddingRight),
			scrollbarWidth: style.scrollbarWidth,
			scrollbarColor: style.scrollbarColor,
		}
	})
	expect(agentScrollGeometry.scrollHeight).toBeGreaterThan(
		agentScrollGeometry.clientHeight,
	)
	expect(agentScrollGeometry.marginTop).toBeGreaterThan(0)
	expect(agentScrollGeometry.marginBottom).toBeGreaterThan(0)
	expect(agentScrollGeometry.paddingRight).toBeGreaterThan(0)
	expect(agentScrollGeometry.scrollbarWidth).not.toBe("thin")
	expect(agentScrollGeometry.scrollbarColor).not.toBe("auto")

	// Programmatic scrolling is deterministic across headless engines; overflow
	// and authored scrollbar styling are asserted above.
	await agentScroller.evaluate((scroller) => scroller.scrollBy(0, 500))
	await expect
		.poll(() => agentScroller.evaluate((scroller) => scroller.scrollTop))
		.toBeGreaterThan(0)
	const scrollLeftBeforePoll = await tableScroller.evaluate((scroller) => {
		scroller.dataset.e2eScrollIdentity = "preserved"
		return scroller.scrollLeft
	})
	const scrollTopBeforePoll = await agentScroller.evaluate((scroller) => {
		scroller.dataset.e2eScrollIdentity = "preserved"
		return scroller.scrollTop
	})
	await page.waitForResponse((response) => {
		const path = new URL(response.url()).pathname
		return (
			response.request().method() === "GET" &&
			path === `/api/runs/${payload.run_id as string}/view`
		)
	})
	await expect(tableScroller).toHaveAttribute(
		"data-e2e-scroll-identity",
		"preserved",
	)
	await expect(agentScroller).toHaveAttribute(
		"data-e2e-scroll-identity",
		"preserved",
	)
	await expect
		.poll(() => tableScroller.evaluate((scroller) => scroller.scrollLeft))
		.toBe(scrollLeftBeforePoll)
	await expect
		.poll(() => agentScroller.evaluate((scroller) => scroller.scrollTop))
		.toBe(scrollTopBeforePoll)
	await expect(
		page.locator(".agent-hud__agent", {
			hasText: "Hello! I generated a text artifact for validation",
		}),
	).toHaveCount(0)
	const next = page.getByRole("button", { name: "Next agent message" })
	await expect(next).toBeEnabled({ timeout: 15_000 })
	await expect(next).not.toHaveAttribute("data-new-message")

	const link = page.getByRole("link", { name: "Open the generated text file" })
	await expect(link).toBeVisible({ timeout: 15_000 })

	const popupPromise = page.waitForEvent("popup")
	await link.click()
	const popup = await popupPromise
	await popup.waitForLoadState("domcontentloaded")

	expect(popup.url()).toContain(`/api/files/${relativePath}`)
	await expect(popup.locator("body")).toContainText(artifactBody)

	await next.click()
	await expect(
		page.locator(".agent-hud__agent", {
			hasText: "Hello! I generated a text artifact for validation",
		}),
	).toBeVisible()
	await expect(page.locator(".agent-hud__textarea")).toBeEnabled()
})
