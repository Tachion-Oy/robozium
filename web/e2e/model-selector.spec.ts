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

// The journal is written by the scripted provider's create() boundary, after
// the real agent and request-option wrapper have resolved the selected route.
test("a UI model switch changes the next request and stays isolated to its run", async ({ page, request }) => {
	const { readFile, writeFile } = await import("node:fs/promises")
	const { join } = await import("node:path")
	const hubRoot = process.env.ROBOSPRAWL_E2E_HUB_BASE_DIR
	if (!hubRoot) throw new Error("Isolated Hub root is required")
	const projects: string[] = []
	const cerebrasId = "model:cerebras:gpt-oss-120b"
	const start = async (name: string) => {
		const slug = await createProject(request, `${name} ${Date.now()}`)
		projects.push(slug)
		await writeFile(join(hubRoot, "projects", slug, ".mock-scenario"), "model-selection")
		const created = await request.post("/api/runs/create", { data: { project: slug } })
		expect(created.ok()).toBeTruthy()
		return { slug, runId: (await created.json()).run_id as string }
	}
	const rows = async (slug: string) => {
		try {
			return (await readFile(join(hubRoot, "projects", slug, ".mock-model-requests.jsonl"), "utf8"))
				.trim().split("\n").map((line) => JSON.parse(line) as { model_id: string; extra_body: unknown })
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
			throw error
		}
	}
	const openPrompt = async (runId: string, count: number) => {
		await page.goto(`/?runId=${encodeURIComponent(runId)}`)
		await expect(page.locator(".agent-hud__agent")).toContainText(`Model request ${count} completed.`, { timeout: 20_000 })
		await expect(page.locator(".agent-hud__textarea")).toBeVisible()
	}
	const reply = async (count: number) => {
		await page.locator(".agent-hud__textarea").fill("continue")
		await page.getByRole("button", { name: "Send", exact: true }).click()
		await expect(page.locator(".agent-hud__agent")).toContainText(`Model request ${count} completed.`, { timeout: 20_000 })
	}
	try {
		expect((await request.post("/api/models", { data: { model_id: defaultGlmId } })).ok()).toBeTruthy()
		const first = await start("Model Request First")
		await openPrompt(first.runId, 1)
		expect((await rows(first.slug)).map((row) => row.model_id)).toEqual([defaultGlmId])
		// A new global default affects future runs only.
		expect((await request.post("/api/models", { data: { model_id: cerebrasId } })).ok()).toBeTruthy()
		const second = await start("Model Request Second")
		await openPrompt(second.runId, 1)
		await openPrompt(first.runId, 1)
		for (const [index, label] of ["GLM-5.3 Flash · OpenRouter", "GLM-5.3 · OpenRouter"].entries()) {
			await page.locator(".agent-hud__model-selector:not(.agent-hud__view-selector) .agent-hud__model-trigger").click()
			await page.getByRole("option", { name: label, exact: true }).click()
			await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible()
			await reply(index + 2)
		}
		expect((await rows(first.slug)).map((row) => row.model_id)).toEqual([defaultGlmId, flashGlmId, defaultGlmId])
		for (const row of await rows(first.slug)) expect(row.extra_body).toEqual({ reasoning: { effort: "low" } })
		await openPrompt(second.runId, 1)
		await reply(2)
		expect((await rows(second.slug)).map((row) => row.model_id)).toEqual([cerebrasId, cerebrasId])
		expect((await (await request.get("/api/models")).json()).selected_model_id).toBe(cerebrasId)
	} finally {
		for (const slug of projects) await request.post(`/api/projects/${encodeURIComponent(slug)}/cancel`)
		await request.post("/api/models", { data: { model_id: defaultGlmId } })
	}
})
