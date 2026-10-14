import { defineConfig } from "@playwright/test"

export default defineConfig({
	testDir: "./tests",
	workers: 1,
	retries: 0,
	forbidOnly: Boolean(process.env.CI),
	failOnFlakyTests: true,
	updateSnapshots: "none",
	timeout: 30_000,
	expect: { timeout: 5_000 },
	reporter: [["list"], ["html", { open: "never" }]],
})
