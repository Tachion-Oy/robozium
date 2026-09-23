import { expect, test, type Locator, type Page } from "@playwright/test"
import { createProject, gotoLanding, selectHudView, waitFor } from "./helpers"

const VIEWPORT = { width: 1920, height: 1080 }
// Containerized Chromium differs from the checked-in baselines by roughly
// 2,200 stable antialiased raster pixels while preserving layout. Keep a
// narrow absolute allowance so larger full-page regressions still fail.
const CI_RASTER_MAX_DIFF_PIXELS = 2_500
const VISUAL_PROJECTS = [
	{
		slug: "atlas-console",
		status: "awaiting_user_input",
		run_id: "visual-atlas-run",
		current_agent_name: "orchestrator",
		created_at: null,
	},
	{
		slug: "paper-trail",
		status: "dormant",
		run_id: null,
		current_agent_name: null,
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
test.describe.configure({ mode: "serial" })

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
	await page.evaluate(() => document.fonts.ready)
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
	options: {
		fullPage?: boolean
		maxDiffPixelRatio?: number
		maxDiffPixels?: number
	} = {},
) {
	for (const theme of ["dark", "light"] as const) {
		await setTheme(page, theme)
		const target = options.fullPage ? page : locator
		await expect(target).toHaveScreenshot(`${name}-${theme}.png`, {
			animations: "disabled",
			caret: "hide",
			maxDiffPixelRatio: options.maxDiffPixelRatio,
			maxDiffPixels: options.maxDiffPixels,
			fullPage: options.fullPage,
		})
	}
}

test("freezes landing, menus, run views, minimized HUD, and warning toast", async ({
	page,
	request,
}) => {
	test.setTimeout(120_000)
	const collectCssCoverage = process.env.ROBOZIUM_CSS_COVERAGE === "1"
	if (collectCssCoverage) await page.coverage.startCSSCoverage()
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

	await gotoLanding(page)
	await stabilize(page)
	await selectHudView(page, "Dependencies")
	await selectHudView(page, "Runs Overview")
	await expect(page.getByText("atlas-console", { exact: true })).toBeVisible()
	await expectThemePair(page, page.locator("html"), "landing-overview", {
		fullPage: true,
		maxDiffPixels: CI_RASTER_MAX_DIFF_PIXELS,
	})

	await page.locator(".agent-hud__model-trigger").first().click()
	await expectThemePair(
		page,
		page.locator(".agent-hud__header"),
		"model-menu",
	)
	await page.keyboard.press("Escape")
	await page.locator(".agent-hud__view-trigger").click()
	await expectThemePair(
		page,
		page.locator(".agent-hud__header"),
		"view-menu",
	)
	await page.keyboard.press("Escape")

	const slug = await createProject(request, "Visual Regression")
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
	await page.goto(`/?runId=${encodeURIComponent(runId)}`)
	await stabilize(page)
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
	await expectThemePair(
		page,
		page.locator(".agent-hud__box"),
		"active-run-awaiting-input",
		{ maxDiffPixels: 5 },
	)

	await selectHudView(page, "Runs Overview")
	await expect(page.getByText("atlas-console", { exact: true })).toBeVisible()
	await expectThemePair(
		page,
		page.locator(".agent-hud__box"),
		"runs-overview",
	)
	await selectHudView(page, "Dependencies")
	await expect(page.locator(".agent-hud__status-view")).toBeVisible()
	await expectThemePair(
		page,
		page.locator(".agent-hud__box"),
		"dependencies",
		{ maxDiffPixels: 100 },
	)
	await selectHudView(page, "Current Run")

	await page.getByRole("button", { name: "Minimize" }).click()
	await expect(page.locator(".agent-hud__mini-box")).toBeVisible()
	await expectThemePair(
		page,
		page.locator(".agent-hud__mini-box"),
		"minimized-hud",
	)
	await page.locator(".agent-hud__mini-expand").click()

	await selectHudView(page, "Dependencies")
	await page.getByRole("button", { name: "Check Now", exact: true }).click()
	await expect(page.locator(".agent-error-toast")).toBeVisible()
	await expectThemePair(
		page,
		page.locator(".agent-error-toast"),
		"warning-toast",
	)

	if (collectCssCoverage) {
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
			maxDiffPixels: CI_RASTER_MAX_DIFF_PIXELS,
		})
	} finally {
		await context.close()
	}
})
