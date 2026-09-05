import { expect, test, type Page } from "@playwright/test"
import { createProject, gotoLanding, projectRow, waitForAnyRowStatus } from "./helpers"

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
	const createButton = page.getByRole("button", { name: "Create Project" })
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

	await expect(page.getByText("New Project", { exact: true })).toBeVisible()
})

test("startup reaps stale preboot running logs so seeded project is not syncing", async ({
	page,
}) => {
	const seededSlug = process.env.ROBOSPRAWL_E2E_PROJECT_SLUG ?? "e2e-project"
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

	await gotoLanding(page)

	const dormantRow = page.locator("ul > li", { hasText: slug })
	await expect(dormantRow).toBeVisible({ timeout: 15_000 })
	await expect(dormantRow.getByText("DORMANT", { exact: true })).toBeVisible({
		timeout: 15_000,
	})

	// Clicking a dormant project mints a run (loading its memory) and attaches.
	await dormantRow.getByRole("button", { name: `Open ${slug}` }).click()
	await expect(dormantRow.getByText("OPENING", { exact: true })).toHaveCount(1)
	await expect(
		dormantRow.getByRole("button", { name: `Open ${slug}` }),
	).toBeDisabled()
	await expect(dormantRow.getByRole("button", { name: "Cancel" })).toBeDisabled()
	await expect(dormantRow.getByRole("button", { name: "Delete" })).toBeDisabled()
	await page.waitForTimeout(1_100)
	await expect(dormantRow.getByText("OPENING", { exact: true })).toHaveCount(1)

	releaseCreate()
	await expect(page).toHaveURL(/[?&]runId=/, { timeout: 10_000 })
	await expect(page.locator(".agent-hud__textarea")).toBeVisible({
		timeout: 15_000,
	})
})

test("only the first rapid project open starts navigation", async ({
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

		// SSR can expose the buttons just before React attaches their handlers.
		// Repeat the same rapid pair until the first click is observed; once it is,
		// the opening lock makes every later native click a no-op.
		await expect
			.poll(async () => {
				await page.evaluate(([first, second]) => {
					const firstButton = document.querySelector<HTMLButtonElement>(
						`button[aria-label="Open ${CSS.escape(first)}"]`,
					)
					const secondButton = document.querySelector<HTMLButtonElement>(
						`button[aria-label="Open ${CSS.escape(second)}"]`,
					)
					if (!firstButton || !secondButton) {
						throw new Error("project buttons missing")
					}
					firstButton.click()
					secondButton.click()
				}, [firstSlug, secondSlug])
				return [...createRequests]
			})
			.toEqual([firstSlug])
		await expect(firstRow.getByText("OPENING", { exact: true })).toBeVisible()
		await expect(secondRow.getByText("DORMANT", { exact: true })).toBeVisible()
		await expect(
			firstRow.getByRole("button", { name: `Open ${firstSlug}` }),
		).toBeDisabled()
		await expect(
			secondRow.getByRole("button", { name: `Open ${secondSlug}` }),
		).toBeDisabled()
		await expect(firstRow.getByText(firstSlug, { exact: true })).toBeVisible()
		await expect(secondRow.getByText(secondSlug, { exact: true })).toBeVisible()

		releaseCreate()
		await expect(page).toHaveURL(/[?&]runId=/, { timeout: 10_000 })
	} finally {
		releaseCreate()
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
	await expect(firstRunRow.getByText("orchestrator", { exact: true })).toBeVisible({
		timeout: 15_000,
	})
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
