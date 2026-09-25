import { expect, test } from "./fixtures"
import { type Page } from "@playwright/test"
import {
	createProject,
	e2eProjectPaths,
	expectLibrarianSettledOnDisk,
	gotoLanding,
	trackCancelPosts,
	waitForAnyRowStatus,
	waitForProjectRowStatus,
} from "./helpers"

test.describe.configure({ mode: "serial" })

/**
 * Start a run through the landing form so the backend actually starts it (the
 * run only begins once its stream opens, which happens on the run page). Returns
 * the project slug, derived from the name.
 */
async function startRun(page: Page, projectName: string): Promise<string> {
	await gotoLanding(page)
	await page.locator("button.agent-hud__start").click()

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
	// Landing on the run page opens the stream, which starts the run.
	await expect(page.locator(".agent-hud__textarea")).toBeVisible({ timeout: 15_000 })
	return projectName.toLowerCase().replace(/\s+/g, "-")
}

test("cancel from landing drives an active project to dormant", async ({ page }) => {
	const slug = await startRun(page, "Cancel E2E")
	const cancelPosts = trackCancelPosts(page, slug)

	await gotoLanding(page)
	const row = await waitForProjectRowStatus(page, slug, "WAITING")

	// Both actions are always visible; a live run only enables Cancel. `exact`
	// matters: the open button's aria-label ("Open cancel-e2e") would otherwise
	// substring-match.
	const cancelButton = row.getByRole("button", { name: "Cancel", exact: true })
	const openButton = row.getByRole("button", { name: `Open ${slug}` })
	const deleteButton = row.getByRole("button", { name: "Delete", exact: true })
	await expect(cancelButton).toBeVisible({ timeout: 15_000 })
	await expect(cancelButton).toBeEnabled()
	await expect(openButton).toBeEnabled()
	await expect(deleteButton).toBeVisible()
	await expect(deleteButton).toBeDisabled()
	await cancelButton.click()
	await expect.poll(() => cancelPosts()).toBeGreaterThanOrEqual(1)

	// Cancellation stops both the root run and its background librarian, so the
	// polling UI may catch a brief SYNCING state or go directly to DORMANT.
	// lifecycle.spec.ts holds the librarian open when testing SYNCING invariants.
	await waitForAnyRowStatus(row, ["SYNCING", "DORMANT"])

	// Once the librarian settles, the project is no longer live and becomes
	// resumable/deletable again.
	await expect(row.getByText("DORMANT", { exact: true })).toBeVisible({
		timeout: 20_000,
	})
	await expectLibrarianSettledOnDisk(e2eProjectPaths(slug).logs)
	await expect(openButton).toBeEnabled()
	await expect(deleteButton).toBeEnabled()
	await expect(cancelButton).toBeDisabled()
})

test("cancel from active run view stops run", async ({ page }) => {
	const slug = await startRun(page, "Cancel From Run View E2E")
	const cancelPosts = trackCancelPosts(page, slug)
	const cancel = page.getByRole("button", { name: "Cancel", exact: true })
	await expect(cancel).toBeVisible({ timeout: 15_000 })
	await page.evaluate((targetSlug: string) => {
		const observedWindow = window as typeof window & {
			__runCancelStatusHistory?: string[]
		}
		const history: string[] = []
		const labels = ["RUNNING", "WAITING", "CANCELLING", "SYNCING", "DORMANT"]
		const record = () => {
			const openButton = [...document.querySelectorAll("button")].find(
				(button) =>
					button.getAttribute("aria-label") === `Open ${targetSlug}`,
			)
			const text = openButton?.closest("li")?.textContent ?? ""
			const status = labels.find((label) => text.includes(label))
			if (status && history.at(-1) !== status) history.push(status)
		}
		observedWindow.__runCancelStatusHistory = history
		new MutationObserver(record).observe(document.documentElement, {
			childList: true,
			characterData: true,
			subtree: true,
		})
		record()
	}, slug)
	await cancel.click()
	// Some browsers can transition through the cancelling HUD state too quickly
	// to observe deterministically; the landing redirect below validates the outcome.
	await expect.poll(() => cancelPosts()).toBeGreaterThanOrEqual(1)

	await expect
		.poll(() => new URL(page.url()).searchParams.get("runId"), {
			timeout: 20_000,
		})
		.toBeNull()
	await expect(page.locator(".agent-hud__project-view")).toBeVisible({
		timeout: 20_000,
	})
	await expect(page.locator(".app-nav__brand")).toBeVisible()
	await expect(page.locator(".agent-hud__view-trigger")).toHaveText(
		"Runs Overview",
	)
	const row = page.locator("ul > li", { hasText: slug })
	// Depending on poll timing, the landing matrix may observe CANCELLING first or land
	// directly on DORMANT after the backend has already settled.
	await waitForAnyRowStatus(row, ["CANCELLING", "DORMANT"])
	await expect(row.getByText("SYNCING", { exact: true })).toHaveCount(0)
	// The background librarian self-stops after draining and the project settles
	// back to DORMANT.
	await expect(row.getByText("DORMANT", { exact: true })).toBeVisible({
		timeout: 20_000,
	})
	await expect
		.poll(() =>
			page.evaluate(() => {
				const observedWindow = window as typeof window & {
					__runCancelStatusHistory?: string[]
				}
				return observedWindow.__runCancelStatusHistory ?? []
			}),
		)
		.toContain("DORMANT")
	const statusHistory = await page.evaluate(() => {
		const observedWindow = window as typeof window & {
			__runCancelStatusHistory?: string[]
		}
		return observedWindow.__runCancelStatusHistory ?? []
	})
	expect(statusHistory).not.toContain("SYNCING")
	expect(statusHistory.at(-1)).toBe("DORMANT")
	// Same endpoint as the row-cancel button (both call cancelProject), and the
	// same disk invariant: no false DORMANT while the librarian is still running.
	await expectLibrarianSettledOnDisk(e2eProjectPaths(slug).logs)
})

test("failed cancel rolls back and can be retried without refreshing", async ({
	page,
}) => {
	const slug = await startRun(page, "Cancel Retry E2E")
	await gotoLanding(page)
	const row = await waitForProjectRowStatus(page, slug, "WAITING")
	const cancel = row.getByRole("button", { name: "Cancel", exact: true })
	let attempts = 0

	await page.route(
		`**/api/projects/${encodeURIComponent(slug)}/cancel`,
		async (route) => {
			attempts += 1
			if (attempts === 1) {
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({ ok: false }),
				})
				return
			}
			await route.continue()
		},
	)

	await cancel.click()
	await expect(page.getByText(`Could not cancel "${slug}".`)).toBeVisible()
	await expect(row.getByText("WAITING", { exact: true })).toBeVisible()
	await expect(cancel).toBeEnabled()

	await cancel.click()
	await expect.poll(() => attempts).toBe(2)
	await expect(row.getByText("DORMANT", { exact: true })).toBeVisible({
		timeout: 20_000,
	})
})

test("delete removes a dormant project after a two-step confirm", async ({
	page,
	request,
}) => {
	const slug = await createProject(request, "Delete E2E")
	let releaseDelete!: () => void
	const deleteGate = new Promise<void>((resolve) => {
		releaseDelete = resolve
	})
	await page.route(
		`**/api/projects/${encodeURIComponent(slug)}`,
		async (route) => {
			if (route.request().method() !== "DELETE") {
				await route.continue()
				return
			}
			await deleteGate
			await route.continue()
		},
	)

	await gotoLanding(page)
	const row = page.locator("ul > li", { hasText: slug })
	await expect(row).toBeVisible({ timeout: 15_000 })
	await expect(row.getByText("DORMANT", { exact: true })).toBeVisible({
		timeout: 15_000,
	})

	// First click only arms the confirm; the project must still be there.
	// `exact` avoids matching the open button's "Open delete-e2e" aria-label.
	await row.getByRole("button", { name: "Delete", exact: true }).click()
	await expect(
		row.getByRole("button", { name: "Confirm?", exact: true }),
	).toBeVisible()

	await row.getByRole("button", { name: "Confirm?", exact: true }).click()
	await expect(row.getByText("DELETING", { exact: true })).toBeVisible()
	await page.waitForTimeout(3_500)
	await expect(row.getByText("DELETING", { exact: true })).toBeVisible()
	await expect(row.getByText("DORMANT", { exact: true })).toHaveCount(0)

	releaseDelete()
	await expect(page.locator("ul > li", { hasText: slug })).toHaveCount(0, {
		timeout: 15_000,
	})
})
