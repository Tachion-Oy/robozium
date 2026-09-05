import { expect, test } from "@playwright/test"
import { createProject, selectHudView } from "./helpers"

test("shows all agents inside a run and returns through the current row", async ({
	page,
	request,
}) => {
	const slug = await createProject(request, `Agents View ${Date.now()}`)
	const createResponse = await request.post("/api/runs/create", {
		data: { project: slug },
	})
	expect(createResponse.ok()).toBeTruthy()
	const { run_id: runId } = (await createResponse.json()) as { run_id: string }

	await page.goto(`/?runId=${encodeURIComponent(runId)}`)
	await expect(page.locator(".agent-hud__run-view")).toBeVisible({
		timeout: 15_000,
	})
	await expect(page.locator(".agent-hud__event-text")).toHaveText(slug)
	const runUrl = page.url()
	const resizeHandle = page.getByRole("slider", { name: "Resize HUD" })
	await expect(resizeHandle).toHaveAttribute("aria-valuenow", "100")

	await selectHudView(page, "Runs Overview")
	await expect(resizeHandle).toHaveAttribute("aria-valuenow", "100")
	await expect(page.locator(".agent-hud__project-view")).toBeVisible()
	await expect(
		page.getByRole("button", { name: "New Project", exact: true }),
	).toBeVisible()

	const currentProject = page.getByRole("button", {
		name: `Return to ${slug}`,
		exact: true,
	})
	const currentRow = currentProject.locator("xpath=..")
	const currentProjectName = currentProject.getByText(slug, { exact: true })
	await expect(currentProject).toHaveAttribute("aria-current", "true")
	await expect(currentProjectName).toHaveClass(
		/agent-hud__project-name--current/,
	)
	const currentRowBackgroundAlpha = await currentRow.evaluate((row) => {
		const canvas = document.createElement("canvas")
		canvas.width = 1
		canvas.height = 1
		const context = canvas.getContext("2d")
		if (!context) throw new Error("Canvas context unavailable")
		context.clearRect(0, 0, 1, 1)
		context.fillStyle = "rgba(0, 0, 0, 0)"
		context.fillStyle = getComputedStyle(row).backgroundColor
		context.fillRect(0, 0, 1, 1)
		return context.getImageData(0, 0, 1, 1).data[3]
	})
	expect(currentRowBackgroundAlpha).toBe(0)
	await expect(currentRow).toHaveCSS("box-shadow", "none")
	await expect(page.locator(".agent-hud__event-text")).toHaveText(slug)
	expect(page.url()).toBe(runUrl)

	await selectHudView(page, "Dependencies")
	await expect(page.locator(".agent-hud__status-view")).toBeVisible()
	await expect(page.locator(".agent-hud__event-text")).toHaveText(slug)

	await selectHudView(page, "Runs Overview")
	await page
		.getByRole("button", { name: `Return to ${slug}`, exact: true })
		.click()
	await expect(page.locator(".agent-hud__run-view")).toBeVisible()
	await expect(resizeHandle).toHaveAttribute("aria-valuenow", "100")
	expect(page.url()).toBe(runUrl)
})
