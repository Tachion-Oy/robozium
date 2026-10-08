import { expect, test } from "./fixtures"
import { type APIRequestContext, type Locator, type Page } from "@playwright/test"
import { createProject, gotoLanding, selectHudView, waitFor } from "./helpers"
import { waitForHudLayout } from "./hud-layout"

const VIEWPORT = { width: 1920, height: 1080 }
const VISUAL_PROJECTS = [
	{
		slug: "atlas-console",
		status: "awaiting_user_input",
		run_id: "visual-atlas-run",
		created_at: null,
	},
	{
		slug: "paper-trail",
		status: "dormant",
		run_id: null,
		created_at: null,
	},
]
const VISUAL_DEPENDENCIES = [
	{
		dependency_id: "executable:rg",
		kind: "executable",
		redacted_metadata: { executable: "rg" },
		status: "available",
		checked_at: "2026-08-19T09:30:00Z",
		latency_ms: 4,
		reason_code: null,
	},
	{
		dependency_id: "model:openrouter:z-ai/glm-5.3",
		kind: "model_endpoint",
		redacted_metadata: { endpoint: "configured" },
		status: "available",
		checked_at: "2026-08-19T09:30:00Z",
		latency_ms: 42,
		reason_code: null,
	},
	{
		dependency_id: "executable:grep",
		kind: "executable",
		redacted_metadata: {},
		status: "unavailable",
		checked_at: "2026-08-19T09:30:00Z",
		latency_ms: null,
		reason_code: "not_found",
	},
]

test.use({ viewport: VIEWPORT })

async function stabilize(page: Page) {
	await page.emulateMedia({ reducedMotion: "reduce" })
	await page.addStyleTag({
		content: `
			*, *::before, *::after {
				animation: none !important;
				transition: none !important;
				caret-color: transparent !important;
			}
		`,
	})
	await waitForHudLayout(page)
}

async function setTheme(page: Page, theme: "dark" | "light") {
	await page.evaluate((nextTheme) => {
		document.documentElement.dataset.theme = nextTheme
		document.documentElement.style.colorScheme = nextTheme
		document.cookie = `app.theme.v1=${nextTheme}; Path=/; Max-Age=31536000; SameSite=Lax`
	}, theme)
}

async function expectThemePair(
	page: Page,
	locator: Locator,
	name: string,
	options: { fullPage?: boolean } = {},
) {
	for (const theme of ["dark", "light"] as const) {
		await setTheme(page, theme)
		if (name !== "minimized-hud") await waitForHudLayout(page, [".agent-hud__header-actions"])
		const target = options.fullPage ? page : locator
		await expect(target).toHaveScreenshot(`${name}-${theme}.png`, {
			animations: "disabled",
			caret: "hide",
			maxDiffPixelRatio: 0.002,
			threshold: 0.2,
			fullPage: options.fullPage,
		})
	}
}

test.beforeEach(async ({ page }) => {
	if (process.env.ROBOZIUM_CSS_COVERAGE === "1") await page.coverage.startCSSCoverage()
	await page.route("**/api/projects", async (route) => {
		if (route.request().method() === "GET") {
			await route.fulfill({ json: VISUAL_PROJECTS })
			return
		}
		await route.continue()
	})
	await page.route("**/api/admin/dependencies", (route) => {
		if (route.request().method() === "POST") {
			return route.fulfill({ status: 500, json: { detail: "Visual dependency failure" } })
		}
		return route.fulfill({ json: VISUAL_DEPENDENCIES })
	})
})

test.afterEach(async ({ page }) => {
	if (process.env.ROBOZIUM_CSS_COVERAGE === "1") {
		const entries = await page.coverage.stopCSSCoverage()
		const totals = entries.reduce(
			(result, entry) => ({
				used: result.used + entry.ranges.reduce(
					(sum, range) => sum + range.end - range.start,
					0,
				),
				total: result.total + (entry.text?.length ?? 0),
			}),
			{ used: 0, total: 0 },
		)
		console.info(
			`CSS coverage: ${totals.used}/${totals.total} bytes (${(
				(totals.used / totals.total) *
				100
			).toFixed(1)}%)`,
		)
	}
})

async function landing(page: Page) {
	await gotoLanding(page)
	await stabilize(page)
	await selectHudView(page, "Dependencies")
	await selectHudView(page, "Runs Overview")
	await expect(page.getByText("atlas-console", { exact: true })).toBeVisible()
}

async function activeRun(page: Page, request: APIRequestContext) {
	test.setTimeout(120_000)
	const slug = await createProject(request, `Visual Regression ${Date.now()}`)
	const projectsResponse = await request.get("/api/projects")
	const projects = projectsResponse.ok()
		? ((await projectsResponse.json()) as Array<{
				slug?: unknown
				run_id?: unknown
			}>)
		: []
	const existingRunId = projects.find((project) => project.slug === slug)?.run_id
	const runId =
		typeof existingRunId === "string"
			? existingRunId
			: await waitFor(
					"visual regression run to become available",
					async () => {
						const createResponse = await request.post("/api/runs/create", {
							data: { project: slug },
						})
						if (!createResponse.ok()) return null
						const payload = (await createResponse.json()) as {
							run_id?: unknown
						}
						return typeof payload.run_id === "string" ? payload.run_id : null
					},
					30_000,
				)
	await page.route("**/api/credentials", (route) =>
		route.fulfill({
			json: { available: true, locked: true, removable: false },
		}),
	)
	await page.goto(`/?runId=${encodeURIComponent(runId)}`)
	await stabilize(page)
	// These snapshots cover the manually expanded HUD.
	const resizeHandle = page.getByRole("slider", { name: "Resize HUD" })
	await resizeHandle.press("End")
	await resizeHandle.blur()
	await expect(
		page.locator(".agent-hud__agent", {
			hasText: "Hello! I generated a text artifact for validation",
		}),
	).toBeVisible({ timeout: 20_000 })
	await expect(page.locator(".agent-hud__logo").first()).toHaveAttribute(
		"data-agent-state",
		"awaiting-input",
		{ timeout: 20_000 },
	)
	await waitForHudLayout(page)
}

test("freezes landing overview", async ({ page }) => {
	await landing(page)
	await expectThemePair(page, page.locator("html"), "landing-overview", { fullPage: true })
})

test("freezes capability selector", async ({ page, request }) => {
	expect(await createProject(request, "paper-trail")).toBe("paper-trail")
	await landing(page)
	await page.getByRole("button", { name: "New Project", exact: true }).click()
	const selector = page.getByRole("form", { name: "Capability selector" })
	await selector.getByLabel("Project name").fill("New project")
	await selector.getByRole("checkbox", { name: /mock guidance/ }).check()
	await expectThemePair(page, page.locator(".agent-hud__box"), "capability-selector")
	await selector.getByRole("button", { name: "Cancel", exact: true }).click()
	await page.locator("li", { has: page.getByRole("button", { name: "Open paper-trail", exact: true }) })
		.getByRole("button", { name: "Tools", exact: true }).click()
	await expect(selector.getByRole("heading", { name: "Project: paper-trail" })).toBeVisible()
	await expect(selector.getByRole("checkbox", { name: /mock guidance/ })).toBeVisible()
	await expectThemePair(page, page.locator(".agent-hud__box"), "capability-selector-existing")
})

for (const menu of ["model", "view"] as const) {
	test(`freezes ${menu} menu`, async ({ page }) => {
		await landing(page)
		await page.locator(`.agent-hud__${menu}-trigger`).first().click()
		await expectThemePair(page, page.locator(".agent-hud__header"), `${menu}-menu`)
	})
}

test("freezes active run awaiting input and checks header geometry", async ({ page, request }) => {
	await activeRun(page, request)

	await setTheme(page, "light")
	for (const width of [1920, 1200, 1050]) {
		await page.setViewportSize({ width, height: VIEWPORT.height })
		await waitForHudLayout(page)
		const badge = page.locator(".agent-hud__event-edge")
		const actions = page.locator(".agent-hud__header-actions")
		await expect(badge).toBeVisible()
		await expect(actions.locator(":scope > *")).toHaveCount(3)
		for (const control of await actions.locator(":scope > *").all()) {
			await expect(control).toBeVisible()
		}
		const badgeBounds = await badge.boundingBox()
		const actionsBounds = await actions.boundingBox()
		const boxBounds = await page.locator(".agent-hud__box").boundingBox()
		expect(badgeBounds && actionsBounds && boxBounds).toBeTruthy()
		if (badgeBounds && actionsBounds && boxBounds) {
			const rem = await page.evaluate(() =>
				Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
			)
			expect(actionsBounds.y - badgeBounds.y - badgeBounds.height).toBeGreaterThan(
				0.4 * rem,
			)
			const badgeCenter = badgeBounds.y + badgeBounds.height / 2
			expect(badgeCenter).toBeGreaterThan(boxBounds.y)
			expect(badgeCenter).toBeLessThan(boxBounds.y + rem)
			expect(badgeBounds.x + badgeBounds.width / 2).toBeCloseTo(
				boxBounds.x + boxBounds.width / 2,
				0,
			)
		}
	}
	await page.setViewportSize(VIEWPORT)
	await expectThemePair(
		page,
		page.locator(".agent-hud__box"),
		"active-run-awaiting-input",
	)
	const agentContentInset = async () => {
		const panel = await page.locator(".agent-hud__replyBox--agent").boundingBox()
		const content = await page.locator(".agent-hud__replyBox--agent .agent-hud__agent").boundingBox()
		expect(panel && content).toBeTruthy()
		return panel && content ? content.y - panel.y : 0
	}
	await waitForHudLayout(page)
	const lightInset = await agentContentInset()
	await setTheme(page, "dark")
	await waitForHudLayout(page)
	const darkInset = await agentContentInset()
	expect(Math.abs(lightInset - darkInset)).toBeLessThanOrEqual(5)
})

test("freezes runs overview", async ({ page, request }) => {
	await activeRun(page, request)

	await selectHudView(page, "Runs Overview")
	await expect(page.getByText("atlas-console", { exact: true })).toBeVisible()
	await setTheme(page, "dark")
	await waitForHudLayout(page, [".agent-hud__project-view"])
	const headerBounds = await page.locator(".agent-hud__header").boundingBox()
	const tableBounds = await page.locator(".agent-hud__project-view").boundingBox()
	const controlsBounds = await page.locator(".agent-hud__header-actions").boundingBox()
	expect(headerBounds && tableBounds && controlsBounds).toBeTruthy()
	if (headerBounds && tableBounds && controlsBounds) {
		expect(tableBounds.y - headerBounds.y - headerBounds.height).toBeGreaterThanOrEqual(
			controlsBounds.height,
		)
	}
	await expectThemePair(
		page,
		page.locator(".agent-hud__box"),
		"runs-overview",
	)
})

test("freezes dependencies", async ({ page, request }) => {
	await activeRun(page, request)

	await selectHudView(page, "Dependencies")
	await expect(page.locator(".agent-hud__status-view")).toBeVisible()
	await expectThemePair(
		page,
		page.locator(".agent-hud__box"),
		"dependencies",
	)
})

test("freezes minimized HUD", async ({ page, request }) => {
	await activeRun(page, request)

	await waitForHudLayout(page)
	await page.getByRole("button", { name: "Minimize" }).click()
	await expect(page.locator(".agent-hud__mini-box")).toBeVisible()
	await expectThemePair(
		page,
		page.locator(".agent-hud__mini-box"),
		"minimized-hud",
	)
})

test("freezes warning toast", async ({ page, request }) => {
	await activeRun(page, request)

	await selectHudView(page, "Dependencies")
	await page.getByRole("button", { name: "Check Now", exact: true }).click()
	await expect(page.locator(".agent-error-toast")).toBeVisible()
	await expectThemePair(
		page,
		page.locator(".agent-error-toast"),
		"warning-toast",
	)
})

test("freezes light CRT rasterization at 1.25 device scale", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) throw new Error("Playwright baseURL is required")
	const context = await browser.newContext({
		baseURL,
		viewport: VIEWPORT,
		deviceScaleFactor: 1.25,
		reducedMotion: "reduce",
	})
	const page = await context.newPage()
	try {
		await context.addCookies([
			{ name: "app.theme.v1", value: "light", url: baseURL },
		])
		await page.route("**/api/projects", (route) => route.fulfill({ json: VISUAL_PROJECTS }))
		await page.goto("/?from=app")
		await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
		await expect(
			page.getByRole("button", { name: "New Project", exact: true }),
		).toBeVisible({ timeout: 15_000 })
		await expect(page.getByText("atlas-console", { exact: true })).toBeVisible()
		await stabilize(page)
		// Keep the visual state explicit immediately before the fractional capture.
		await setTheme(page, "light")
		await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
		await expect(page).toHaveScreenshot("light-crt-1.25x.png", {
			animations: "disabled",
			caret: "hide",
			fullPage: true,
			maxDiffPixelRatio: 0.002,
			threshold: 0.2,
		})
	} finally {
		await context.close()
	}
})
