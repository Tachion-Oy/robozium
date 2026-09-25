import { expect, test } from "./fixtures"
import { createProject, gotoLanding } from "./helpers"

test.describe.configure({ mode: "serial" })

let projectSlug: string

test("a browser test can leave a mock run waiting for input", async ({ request }) => {
	projectSlug = await createProject(request, `Cleanup E2E ${Date.now()}`)
	const response = await request.post("/api/runs/create", { data: { project: projectSlug } })
	expect(response.ok()).toBeTruthy()
	await expect.poll(async () => {
		const projects = await (await request.get("/api/projects")).json() as Array<{ slug: string; status: string }>
		return projects.find((project) => project.slug === projectSlug)?.status
	}).toMatch(/^(running|awaiting_user_input)$/)
})

test("the next browser test sees the run stopped and both routes responsive", async ({ page, request }) => {
	await expect.poll(async () => {
		const response = await request.get("/api/projects", { timeout: 5_000 })
		expect(response.ok()).toBeTruthy()
		const projects = await response.json() as Array<{ slug: string; status: string }>
		return projects.find((project) => project.slug === projectSlug)?.status
	}, { timeout: 15_000 }).toBe("dormant")
	await gotoLanding(page)
	await expect(page.getByRole("button", { name: `Open ${projectSlug}` })).toBeVisible()
})
