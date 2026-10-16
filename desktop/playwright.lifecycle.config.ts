import { defineConfig } from "@playwright/test"
import native from "./playwright.config"

export default defineConfig({
	...native,
	testDir: "./lifecycle-tests",
	timeout: 240_000,
	outputDir: "test-results/lifecycle",
})
