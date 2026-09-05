import { expect, test } from "@playwright/test"
import { createProject, gotoLanding } from "./helpers"

const defaultGlmId = "model:openrouter:z-ai/glm-5.3"
const flashGlmId = "model:openrouter:z-ai/glm-5.3-flash"

test("selects GPT-OSS on landing and keeps it visible during a run", async ({
	page,
	request,
}) => {
	await request.post("/api/models", { data: { model_id: flashGlmId } })

	try {
		await gotoLanding(page)
		const trigger = page.getByRole("button", {
			name: "GLM-5.3 Flash · OpenRouter",
			exact: true,
		})
		await expect(trigger).toBeVisible()
		await trigger.click()
		await page
			.getByRole("option", { name: "GPT-OSS-120B · Cerebras", exact: true })
			.click()
		await expect(
			page.getByRole("button", {
				name: "GPT-OSS-120B · Cerebras",
				exact: true,
			}),
		).toBeVisible()

		const slug = await createProject(request, `Model Selector ${Date.now()}`)
		const createResponse = await request.post("/api/runs/create", {
			data: { project: slug },
		})
		expect(createResponse.ok()).toBeTruthy()
		const { run_id: runId } = (await createResponse.json()) as { run_id: string }

		await page.goto(`/?runId=${encodeURIComponent(runId)}`)
		await expect(
			page.getByRole("button", {
				name: "GPT-OSS-120B · Cerebras",
				exact: true,
			}),
		).toBeVisible({ timeout: 15_000 })
		await expect(page.locator(".agent-hud__view-trigger")).toHaveText(
			"Current Run",
		)
	} finally {
		await request.post("/api/models", { data: { model_id: defaultGlmId } })
	}
})
