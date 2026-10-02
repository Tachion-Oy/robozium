import fs from "node:fs/promises"
import path from "node:path"
import { test as base, expect, type APIRequestContext } from "@playwright/test"
import { e2eProjectPaths, librarianIsRunningOnDisk } from "./helpers"

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

/** Release test holds and await test-owned agents before the next case starts. */
export const test = base.extend<{ cleanProjectRuns: void }>({
	cleanProjectRuns: [async ({ request }, use) => {
		let before: Map<string, Project>
		try {
			before = new Map((await projects(request)).map((project) => [project.slug, project]))
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
						for (const marker of [".librarian-hold", ".librarian-consolidation-hold", ".librarian-cancel-hold", ".mock-first-message-hold"]) {
							await fs.rm(path.join(hub, "projects", slug, marker), { force: true })
						}
					}
				}
				const activeStatuses = ["running", "awaiting_user_input", "syncing", "cancelling"]
				const owned = (await projects(request)).filter((project) => {
					const previous = before.get(project.slug)
					return !previous || previous.run_id !== project.run_id ||
						(!activeStatuses.includes(previous.status) && activeStatuses.includes(project.status))
				})
				// Attempt every cancellation even if one request fails.
				const cancellations = await Promise.allSettled(owned.map(async (project) => {
					if (!activeStatuses.includes(project.status)) return
					const response = await request.post(`/api/projects/${encodeURIComponent(project.slug)}/cancel`, { timeout: 15_000 })
					expect(response.ok()).toBeTruthy()
				}))
				await expect.poll(async () => {
					const current = await projects(request)
					return (await Promise.all(owned.map(async (project) => {
						const state = current.find((entry) => entry.slug === project.slug)
						const { logs } = e2eProjectPaths(project.slug)
						return !state || (!activeStatuses.includes(state.status) &&
							!await librarianIsRunningOnDisk(logs))
					}))).every(Boolean)
				}, { timeout: 30_000 }).toBe(true)
				const errors = cancellations.filter((result) => result.status === "rejected")
				if (errors.length) throw new AggregateError(errors.map((result) => result.reason), "Run cleanup failed")
			} catch (error) {
				await recordFixtureError("cleanup", error)
				throw error
			}
		}
	}, { auto: true, timeout: 60_000 }],
})
