import { expect, test } from "@playwright/test"
import { createProject } from "./helpers"

test("an unknown run keeps its toast, returns home, and stops polling", async ({
	page,
	request,
}) => {
	const slug = await createProject(request, `Invalid Run Recovery ${Date.now()}`)
	const invalidRunId = `missing-${Date.now()}`
	let runViewRequests = 0
	page.on("request", (request) => {
		if (
			new URL(request.url()).pathname ===
			`/api/runs/${encodeURIComponent(invalidRunId)}/view`
		) {
			runViewRequests += 1
		}
	})

	await page.goto(`/?runId=${encodeURIComponent(invalidRunId)}`)

	const toast = page.locator(".agent-error-toast").filter({
		has: page.locator(".agent-error-toast__title", {
			hasText: /^Connection problem$/,
		}),
	})
	await expect(toast).toBeVisible({ timeout: 20_000 })
	await expect
		.poll(() => new URL(page.url()).searchParams.get("runId"))
		.toBeNull()
	await expect(page.locator(".agent-hud__project-view")).toBeVisible()
	await expect(
		page.getByRole("button", { name: "New Project", exact: true }),
	).toBeVisible()
	await expect(page.locator(".app-nav__brand")).toBeVisible()
	await expect(page.locator(".agent-hud__view-trigger")).toHaveText(
		"Runs Overview",
	)
	await expect(
		page.getByRole("slider", { name: "Resize HUD" }),
	).toHaveAttribute("aria-valuenow", "0")
	await expect(page.locator(".term-log")).not.toHaveClass(
		/term-log--scrollable/,
	)
	const requestsAfterLanding = runViewRequests
	await page.waitForTimeout(2_200)
	expect(runViewRequests).toBe(requestsAfterLanding)

	await toast.getByRole("button", { name: "Dismiss error notification" }).click()
	await expect(toast).toHaveCount(0)

	await page.getByRole("button", { name: `Open ${slug}`, exact: true }).click()
	await expect
		.poll(() => new URL(page.url()).searchParams.get("runId"))
		.not.toBe(invalidRunId)
	await expect(page.locator(".agent-hud__textarea")).toBeVisible({
		timeout: 20_000,
	})
})
