import { expect, test } from "@playwright/test"
import { gotoLanding } from "./helpers"

test("mock mode exposes only the mock model", async ({ page, request }) => {
	const response = await request.get("/api/models")
	expect(response.ok()).toBeTruthy()
	expect(await response.json()).toEqual({
		models: [{ model_id: "model:mock:mock", label: "Mock" }],
		selected_model_id: "model:mock:mock",
	})

	await gotoLanding(page)
	await expect(page.getByRole("button", { name: "Mock", exact: true })).toBeVisible()
	await expect(page.getByText("OpenRouter", { exact: false })).toHaveCount(0)
	await expect(page.getByText("Cerebras", { exact: false })).toHaveCount(0)
})
