import { expect } from "@playwright/test"
import { test as native, json, reloadApp, type FakeBackend } from "./native"
export { json }

export const catalogue = {
	models: [{ model_id: "one", label: "First model" }, { model_id: "two", label: "Second model" }],
	selected_model_id: "one",
}
/** A backend project summary; tests override the status or run identity they exercise. */
export const project = (slug: string, overrides: Record<string, unknown> = {}) => ({
	slug, status: "dormant", run_id: null, created_at: null, ...overrides,
})
export interface Backend extends FakeBackend {
	/** Reload the app on this test's handlers; by default wait until the overview has listed projects. */
	open: (options?: { awaitOverview?: boolean }) => Promise<void>
}

// Replace the fake backend's answers with this suite's own; each test adds handlers, then opens the app.
export const test = native.extend<{ backend: Backend }>({
	backend: async ({ desktop: { page }, fakeBackend }, use) => {
		const { handlers, requests } = fakeBackend
		handlers.clear()
		handlers.set("GET /ready", response => json(response, { status: "ready" }))
		handlers.set("GET /projects", response => json(response, [project("existing-project")]))
		handlers.set("GET /models", response => json(response, catalogue))
		handlers.set("GET /capabilities", response => json(response, []))
		await use({ ...fakeBackend, open: async ({ awaitOverview = true } = {}) => {
			// Only the requests of the document under test count.
			requests.length = 0
			await reloadApp(page)
			if (awaitOverview) await expect(page.getByRole("button", { name: "New Project", exact: true })).toBeVisible()
		} })
	},
})
