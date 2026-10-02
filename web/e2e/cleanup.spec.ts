import { expect, test } from "./fixtures"
import fs from "node:fs/promises"
import path from "node:path"
import { createProject, e2eProjectPaths, gotoLanding } from "./helpers"

test.describe.configure({ mode: "serial" })

let projectSlug: string

const HOLD_MARKERS = [".mock-first-message-hold", ".librarian-hold", ".librarian-consolidation-hold", ".librarian-cancel-hold"]

test("a browser test can leave a held mock run active", async ({ request }) => {
	projectSlug = await createProject(request, `Cleanup E2E ${Date.now()}`)
	const { root } = e2eProjectPaths(projectSlug)
	await fs.writeFile(path.join(root, ".mock-scenario"), "held-first-message")
	for (const marker of HOLD_MARKERS) await fs.writeFile(path.join(root, marker), "")
	const response = await request.post("/api/runs/create", { data: { project: projectSlug } })
	expect(response.ok()).toBeTruthy()
	await expect.poll(async () => {
		const projects = await (await request.get("/api/projects")).json() as Array<{ slug: string; status: string }>
		return projects.find((project) => project.slug === projectSlug)?.status
	}).toMatch(/^(running|awaiting_user_input)$/)
})

test("the next browser test sees the run stopped and both routes responsive", async ({ page, request }) => {
	// Teardown must have finished before this test starts; no settling poll here.
	const response = await request.get("/api/projects", { timeout: 5_000 })
	expect(response.ok()).toBeTruthy()
	const projects = await response.json() as Array<{ slug: string; status: string }>
	expect(projects.find((project) => project.slug === projectSlug)?.status).toBe("dormant")
	const { root } = e2eProjectPaths(projectSlug)
	for (const marker of HOLD_MARKERS) {
		await expect(fs.access(path.join(root, marker))).rejects.toThrow()
	}
	await gotoLanding(page)
	await expect(page.getByRole("button", { name: `Open ${projectSlug}` })).toBeVisible()
})
