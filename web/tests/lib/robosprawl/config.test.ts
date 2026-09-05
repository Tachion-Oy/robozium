import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_BASE_URL = process.env.ROBOSPRAWL_API_BASE_URL;

async function importConfig() {
	vi.resetModules();
	return import("../../../lib/robosprawl/config");
}

afterEach(() => {
	if (ORIGINAL_BASE_URL === undefined) {
		delete process.env.ROBOSPRAWL_API_BASE_URL;
	} else {
		process.env.ROBOSPRAWL_API_BASE_URL = ORIGINAL_BASE_URL;
	}
});

describe("ROBOSPRAWL_API_BASE_URL", () => {
	it("uses the explicit environment variable", async () => {
		process.env.ROBOSPRAWL_API_BASE_URL = "http://api.test:8000";

		const config = await importConfig();

		expect(config.ROBOSPRAWL_API_BASE_URL).toBe("http://api.test:8000");
	});

	it("fails fast when the environment variable is missing", async () => {
		delete process.env.ROBOSPRAWL_API_BASE_URL;

		await expect(importConfig()).rejects.toThrow("ROBOSPRAWL_API_BASE_URL must be set");
	});

	it("fails fast when the environment variable is blank", async () => {
		process.env.ROBOSPRAWL_API_BASE_URL = " ";

		await expect(importConfig()).rejects.toThrow("ROBOSPRAWL_API_BASE_URL must be set");
	});
});
