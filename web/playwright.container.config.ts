import { defineConfig, devices } from "@playwright/test"

const baseURL = process.env.ROBOZIUM_CONTAINER_BASE_URL
if (!baseURL) throw new Error("ROBOZIUM_CONTAINER_BASE_URL is required")

export default defineConfig({
	testDir: "./container",
	fullyParallel: false,
	forbidOnly: true,
	retries: 0,
	workers: 1,
	reporter: "list",
	timeout: 60_000,
	expect: { timeout: 15_000 },
	use: {
		baseURL,
		screenshot: "only-on-failure",
		trace: "retain-on-failure",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
