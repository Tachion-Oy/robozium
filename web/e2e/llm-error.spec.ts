import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { createProject } from "./helpers"

test("shows LLM failure toast when mock scenario is llm-error", async ({
	page,
	request,
}) => {
	const hubBaseDir = process.env.ROBOSPRAWL_E2E_HUB_BASE_DIR
	if (!hubBaseDir) {
		throw new Error("ROBOSPRAWL_E2E_HUB_BASE_DIR is required for this test.")
	}

	const slug = await createProject(request, "LLM Error E2E")

	await mkdir(join(hubBaseDir, "projects", slug), { recursive: true })
	await writeFile(
		join(hubBaseDir, "projects", slug, ".mock-scenario"),
		"llm-error",
		"utf-8",
	)

	const createRunResponse = await request.post("/api/runs/create", {
		data: { project: slug },
	})
	expect(createRunResponse.ok()).toBeTruthy()
	const payload = (await createRunResponse.json()) as { run_id?: unknown }
	expect(typeof payload.run_id).toBe("string")
	const runId = payload.run_id as string

	await page.goto(`/?runId=${encodeURIComponent(runId)}`)
	await expect(page.locator(".agent-hud__textarea")).toBeVisible({ timeout: 20_000 })

	await expect(
		page.locator(".agent-hud__agent", {
			hasText: "About to simulate an LLM failure. Reply to continue.",
		}),
	).toBeVisible({ timeout: 20_000 })

	await page.locator(".agent-hud__textarea").fill("continue")
	const sendButton = page.getByRole("button", { name: "Send", exact: true })
	await expect(sendButton).toBeEnabled()
	await sendButton.click()

	const llmFailureToast = page.locator(".agent-error-toast").filter({
		has: page.locator(".agent-error-toast__title", {
			hasText: /^LLM call failed$/,
		}),
	})
	await expect(llmFailureToast).toBeVisible({ timeout: 20_000 })
	await expect(
		llmFailureToast.locator(".agent-error-toast__message"),
	).toHaveText("LLM call failed: mock/mock")
	await expect(llmFailureToast).toHaveClass(/--warning/)

	await expect(
		page.locator(".agent-hud__agent", {
			hasText: "Choose another model, then enter retry and Send.",
		}),
	).toBeVisible({ timeout: 20_000 })

	await page
		.locator(".agent-hud__model-selector:not(.agent-hud__view-selector) .agent-hud__model-trigger")
		.click()
	await page
		.locator('.agent-hud__model-option[aria-selected="false"]')
		.first()
		.click()
	await page.locator(".agent-hud__textarea").fill("retry")
	await expect(sendButton).toBeEnabled()
	await sendButton.click()

	await expect
		.poll(() => new URL(page.url()).searchParams.get("runId"), {
			timeout: 20_000,
		})
		.toBeNull()
	await expect(
		page.getByRole("button", { name: "New Project", exact: true }),
	).toBeVisible()
})
