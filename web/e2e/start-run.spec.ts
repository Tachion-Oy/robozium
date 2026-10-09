import { expect, test } from "./fixtures"
import { type Page } from "@playwright/test"
import { rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { createProject, e2eProjectPaths, gotoLanding, projectRow, waitForAnyRowStatus } from "./helpers"

test.describe.configure({ mode: "serial" })

async function startRunFromLanding(
	page: Page,
	projectName = "E2E Project",
): Promise<string> {
	await gotoLanding(page)

	const startButton = page.locator("button.agent-hud__start")
	await expect(startButton).toBeVisible()
	await startButton.click()

	const projectInput = page.getByLabel("Project name")
	await expect(projectInput).toBeVisible()
	await projectInput.fill(projectName)
	const createButton = page.getByRole("form", { name: "Capability selector" }).getByRole("button", { name: "Launch", exact: true })
	await expect(createButton).toBeEnabled()
	await createButton.evaluate((button: HTMLButtonElement) =>
		button.form?.requestSubmit(),
	)
	await expect(page).toHaveURL(/[?&]runId=/, { timeout: 20_000 })
	const runId = new URL(page.url()).searchParams.get("runId")

	expect(runId).toBeTruthy()
	return runId as string
}

test("shows the New Project button on landing", async ({ page }) => {
	await gotoLanding(page)

	await expect(page.getByRole("button", { name: "New Project", exact: true })).toBeVisible()
})

test("keeps a failed reply visible and allows retry", async ({ page }) => {
	let firstMessageHold: string | undefined
	await page.route("**/api/runs/create", async (route) => {
		const { project } = route.request().postDataJSON() as { project: string }
		const { root } = e2eProjectPaths(project)
		firstMessageHold = join(root, ".mock-first-message-hold")
		await writeFile(join(root, ".mock-scenario"), "held-first-message", "utf-8")
		await writeFile(firstMessageHold, "", "utf-8")
		await route.continue()
	}, { times: 1 })
	const runId = await startRunFromLanding(page, `Reply Retry ${Date.now()}`)
	const draft = page.locator(".agent-hud__textarea")
	const send = page.getByRole("button", { name: "Send", exact: true })
	await expect(draft).toBeVisible()
	await expect(send).toBeDisabled()
	// Navigation can show the editor before the first prompt is ready.
	expect(firstMessageHold).toBeDefined()
	await rm(firstMessageHold!)
	await expect(page.locator(".agent-hud__agent", {
		hasText: "Hello! I generated a text artifact for validation:",
	})).toBeVisible({ timeout: 30_000 })
	await draft.fill("Please continue")
	await expect(draft).toHaveValue("Please continue")
	await expect(send).toBeEnabled({ timeout: 30_000 })
	await page.route(`**/api/runs/${encodeURIComponent(runId)}/reply`, (route) =>
		route.fulfill({ status: 503, json: { detail: "Temporarily unavailable" } }),
		{ times: 1 },
	)
	await send.click()
	await expect(page.getByText("Reply failed", { exact: true })).toBeVisible()
	await expect(draft).toHaveValue("Please continue")
	await expect(send).toBeEnabled()
	await send.click()
	await expect(draft).toHaveValue("")
	await expect(page.locator(".agent-hud__agent", {
		hasText: "Thanks. One more thing before I finish?",
	})).toBeVisible({ timeout: 30_000 })
})

test("startup reaps stale preboot running logs so seeded project is not syncing", async ({
	page,
}) => {
	const seededSlug = process.env.ROBOZIUM_E2E_PROJECT_SLUG ?? "e2e-project"
	await gotoLanding(page)
	const row = projectRow(page, seededSlug)
	await expect(row).toBeVisible({ timeout: 20_000 })
	await waitForAnyRowStatus(row, ["DORMANT", "WAITING", "RUNNING", "CANCELLING"])
	await expect(row.getByText("SYNCING", { exact: true })).toHaveCount(0)
})

test("dormant project on disk is listed and resumes on click", async ({
	page,
	request,
}) => {
	// A project folder with no live run is the post-restart steady state: it
	// exists on disk but the in-memory run is gone. Creating it via the API
	// manifests the folder without starting a run, so it must surface as DORMANT.
	const slug = await createProject(request, `Dormant E2E ${Date.now()}`)
	let releaseCreate!: () => void
	const createGate = new Promise<void>((resolve) => {
		releaseCreate = resolve
	})
	await page.route("**/api/runs/create", async (route) => {
		if (route.request().method() !== "POST") {
			await route.continue()
			return
		}
		await createGate
		await route.continue()
	})

	try {
		await gotoLanding(page)
		const dormantRow = page.locator("ul > li", { hasText: slug })
		await expect(dormantRow).toBeVisible({ timeout: 15_000 })
		await expect(dormantRow.getByText("DORMANT", { exact: true })).toBeVisible({
			timeout: 15_000,
		})

		await dormantRow.getByRole("button", { name: `Open ${slug}` }).click()
		const selector = page.getByRole("form", { name: "Capability selector" })
		await expect(selector).toBeVisible()
		await selector.getByRole("button", { name: "Launch", exact: true }).click()
		await expect(selector.getByRole("button", { name: "Launching…" })).toBeDisabled()
		await expect(selector.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled()

		releaseCreate()
		await expect(page).toHaveURL(/[?&]runId=/, { timeout: 10_000 })
		await expect(page.locator(".agent-hud__textarea")).toBeVisible({
			timeout: 15_000,
		})
	} finally {
		releaseCreate()
		await page.unrouteAll({ behavior: "wait" })
	}
})

test("only the first of two rapid project launches starts navigation", async ({
	page,
	request,
}) => {
	const firstSlug = await createProject(request, `First Open E2E ${Date.now()}`)
	const secondSlug = await createProject(request, `Second Open E2E ${Date.now()}`)
	const createRequests: string[] = []
	let releaseCreate!: () => void
	const createGate = new Promise<void>((resolve) => {
		releaseCreate = resolve
	})
	await page.route("**/api/runs/create", async (route) => {
		if (route.request().method() !== "POST") {
			await route.continue()
			return
		}
		const body = route.request().postDataJSON() as { project?: string }
		if (body.project) createRequests.push(body.project)
		await createGate
		await route.continue()
	})

	try {
		await gotoLanding(page)
		const firstRow = projectRow(page, firstSlug)
		const secondRow = projectRow(page, secondSlug)
		await expect(firstRow.getByText("DORMANT", { exact: true })).toBeVisible()
		await expect(secondRow.getByText("DORMANT", { exact: true })).toBeVisible()

		await firstRow.getByRole("button", { name: "Launch", exact: true }).focus()
		await page.evaluate(([first, second]) => {
			for (const slug of [first, second]) {
				const row = document.querySelector(`button[aria-label="Open ${CSS.escape(slug)}"]`)!.closest("li")!
				row.querySelector<HTMLButtonElement>(".agent-hud__row-launch")!.click()
			}
		}, [firstSlug, secondSlug])
		await expect.poll(() => [...createRequests]).toEqual([firstSlug])
		await expect(firstRow.getByText("OPENING", { exact: true })).toBeVisible()
		await expect(secondRow.getByText("DORMANT", { exact: true })).toBeVisible()
		await expect(firstRow.getByRole("button", { name: "Launch", exact: true })).toBeDisabled()
		await expect(secondRow.getByRole("button", { name: "Launch", exact: true })).toBeDisabled()

		releaseCreate()
		await expect(page).toHaveURL(/[?&]runId=/, { timeout: 10_000 })
	} finally {
		releaseCreate()
		await page.unrouteAll({ behavior: "wait" })
	}
})

test("create run endpoint returns a run_id", async ({ request }) => {
	const slug = await createProject(request, `Create Run E2E ${Date.now()}`)

	const response = await request.post("/api/runs/create", {
		data: { project: slug },
	})
	expect(response.ok()).toBeTruthy()

	const payload = (await response.json()) as { run_id?: unknown }
	expect(typeof payload.run_id).toBe("string")
	expect((payload.run_id as string).length).toBeGreaterThan(0)
})

test("starting a run shows a live row", async ({ page }) => {
	const projectSlug = `live-row-e2e-${Date.now()}`
	await startRunFromLanding(page, projectSlug)
	await gotoLanding(page)

	const row = page.locator("ul > li", { hasText: projectSlug })
	await expect(row).toBeVisible({ timeout: 15_000 })
	const liveStatus = await waitForAnyRowStatus(row, ["RUNNING", "WAITING"])
	expect(["RUNNING", "WAITING"]).toContain(liveStatus)
})

test("landing table shows project and ignores prompt replies", async ({
	page,
}) => {
	test.setTimeout(60_000)
	const firstReply = "first-user-reply"
	const secondReply = "second-user-reply"
	const projectSlug = `landing-replies-e2e-${Date.now()}`
	const createRunId = await startRunFromLanding(page, projectSlug)
	await expect(page).toHaveURL(
		new RegExp(`[?&]runId=${encodeURIComponent(createRunId)}`),
		{ timeout: 5_000 },
	)

	await expect(page.locator(".agent-hud__textarea")).toBeVisible({ timeout: 15_000 })

	await gotoLanding(page)
	await expect(page).toHaveURL("/", { timeout: 5_000 })

	// Other serial tests (e.g. the dormant-project case) leave their own live
	// projects in the shared backend, so target this run's row by slug rather
	// than assuming it sorts first.
	const firstRunRow = page.locator("ul > li", { hasText: projectSlug })
	await expect(firstRunRow).toBeVisible({ timeout: 15_000 })
	await expect(firstRunRow.getByText("WAITING", { exact: true })).toBeVisible({
		timeout: 15_000,
	})
	await expect(firstRunRow.getByText(projectSlug, { exact: true })).toBeVisible({
		timeout: 15_000,
	})
	await expect(firstRunRow.getByText("orchestrator", { exact: true })).toHaveCount(0)
	const openButton = firstRunRow.getByRole("button", {
		name: `Open ${projectSlug}`,
	})
	await expect(openButton).toBeEnabled()
	await openButton.click()

	await expect(page).toHaveURL(/[?&]runId=/, {
		timeout: 15_000,
	})
	await expect(page.locator(".agent-hud__textarea")).toBeVisible({ timeout: 15_000 })

	await page.locator(".agent-hud__textarea").fill(firstReply)
	const sendButton = page.getByRole("button", { name: "Send", exact: true })
	await expect(sendButton).toBeEnabled()
	await sendButton.click()

	await expect(
		page.locator(".agent-hud__agent", {
			hasText: "Thanks. One more thing before I finish?",
		}),
	).toBeVisible({ timeout: 15_000 })

	await gotoLanding(page)
	await expect(page).toHaveURL("/", { timeout: 5_000 })

	const activeRunRow = page.locator("ul > li", { hasText: projectSlug })
	await expect(activeRunRow).toBeVisible({ timeout: 15_000 })
	await expect(activeRunRow.getByText(projectSlug, { exact: true })).toBeVisible({
		timeout: 15_000,
	})
	await expect(activeRunRow.getByText(firstReply, { exact: true })).toHaveCount(0)
	await expect(activeRunRow.getByText(secondReply, { exact: true })).toHaveCount(0)
})
