import fs from "node:fs/promises"
import path from "node:path"
import { test as base, expect, type APIRequestContext } from "@playwright/test"

export { expect }

type Project = { slug: string; run_id: string | null; status: string }

async function projects(request: APIRequestContext): Promise<Project[]> {
	let lastError: unknown
	for (let attempt = 0; attempt < 3; attempt += 1) {
		let response
		try {
			response = await request.get("/api/projects", { timeout: 15_000 })
		} catch (error) {
			lastError = error
			if (attempt === 2) throw error
			await new Promise((resolve) => setTimeout(resolve, 250))
			continue
		}
		expect(response.ok()).toBeTruthy()
		return await response.json() as Project[]
	}
	throw lastError
}

async function recordFixtureError(phase: string, error: unknown): Promise<void> {
	const directory = process.env.ROBOZIUM_E2E_REPORT_DIR
	if (directory) {
		await fs.appendFile(path.join(directory, "fixture-errors.log"), `${phase}: ${String(error)}\n`)
	}
}

/** Keep one serial suite from loading the shared mock backend with earlier tests' agents. */
export const test = base.extend<{ cleanProjectRuns: void }>({
	cleanProjectRuns: [async ({ request }, use) => {
		let before: Map<string, string | null>
		try {
			before = new Map((await projects(request)).map((project) => [project.slug, project.run_id]))
		} catch (error) {
			await recordFixtureError("setup", error)
			throw error
		}
		try {
			// eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright fixture continuation.
			await use()
		} finally {
			try {
				const hub = process.env.ROBOZIUM_E2E_HUB_BASE_DIR
				// Release holds first, even when the API is too slow to list projects.
				if (hub) {
					for (const slug of await fs.readdir(path.join(hub, "projects"))) {
						for (const marker of [".librarian-hold", ".librarian-consolidation-hold", ".librarian-cancel-hold"]) {
							await fs.rm(path.join(hub, "projects", slug, marker), { force: true })
						}
					}
				}
				const after = await projects(request)
				for (const project of after) {
					if (before.has(project.slug) && before.get(project.slug) === project.run_id) continue
					if (["running", "awaiting_user_input", "syncing", "cancelling"].includes(project.status)) {
						const response = await request.post(`/api/projects/${encodeURIComponent(project.slug)}/cancel`, { timeout: 15_000 })
						expect(response.ok()).toBeTruthy()
					}
				}
			} catch (error) {
				await recordFixtureError("cleanup", error)
				throw error
			}
		}
	}, { auto: true }],
})
