import { expect, test, type Page } from "@playwright/test"
import fs from "node:fs/promises"
import path from "node:path"
import { walkFiles, waitFor } from "./helpers"

async function startRunForProject(
	page: Page,
	projectSlug: string,
	cancelProject: (slug: string) => Promise<Response>,
	createRun: (slug: string) => Promise<Response>,
): Promise<void> {
	// If a prior spec left this seeded project busy, request cancellation first.
	try {
		await cancelProject(projectSlug)
	} catch {
		// Best effort only; create retries below handle eventual readiness.
	}
	const deadlineMs = Date.now() + 20_000
	while (Date.now() < deadlineMs) {
		const response = await createRun(projectSlug)
		if (response.ok) {
			const payload = (await response.json()) as { run_id?: unknown }
			if (typeof payload.run_id === "string") {
				await page.goto(`/?runId=${encodeURIComponent(payload.run_id)}`)
				await expect(page).toHaveURL(/[?&]runId=/, { timeout: 10_000 })
				return
			}
		}
		// Busy (409) means a previous run is still unwinding; retry shortly.
		if (response.status() !== 409) break
		await page.waitForTimeout(250)
	}
	throw new Error(`Timed out starting run for project '${projectSlug}'`)
}

test("librarian generates snapshot and purges logs", async ({ page, request }) => {
	const conversationRoot = process.env.ROBOSPRAWL_E2E_CONVERSATION_LOGS_DIR
	const snapshotRoot = process.env.ROBOSPRAWL_E2E_SNAPSHOT_DIR
	const seedConversationId = process.env.ROBOSPRAWL_E2E_SEED_CONVERSATION_ID
	const oldestSeedPath = process.env.ROBOSPRAWL_E2E_OLDEST_SEED_PATH
	const seededSlug = process.env.ROBOSPRAWL_E2E_PROJECT_SLUG ?? "e2e-project"

	expect(conversationRoot).toBeTruthy()
	expect(snapshotRoot).toBeTruthy()
	expect(seedConversationId).toBeTruthy()
	expect(oldestSeedPath).toBeTruthy()

	const snapshotFolder = path.join(
		snapshotRoot as string,
		seedConversationId as string,
	)

	await startRunForProject(
		page,
		seededSlug,
		(slug) => request.post(`/api/projects/${encodeURIComponent(slug)}/cancel`),
		(slug) => request.post("/api/runs/create", { data: { project: slug } }),
	)

	const snapshotPath = await waitFor("librarian snapshot markdown", async () => {
		const markdownFiles = await walkFiles(snapshotFolder, ".md")
		return markdownFiles[0] ?? null
	})

	const snapshotText = await fs.readFile(snapshotPath, "utf8")
	expect(snapshotText).toContain("# Conversation Snapshot")
	expect(snapshotText).toContain("Librarian generated this memory.")

	await waitFor("purged conversation log count", async () => {
		const jsonFiles = await walkFiles(conversationRoot as string, ".json")
		return jsonFiles.length <= 4 ? jsonFiles.length : null
	})

	await waitFor("oldest seeded log deletion", async () => {
		try {
			await fs.access(oldestSeedPath as string)
			return null
		} catch {
			return true
		}
	})
})
