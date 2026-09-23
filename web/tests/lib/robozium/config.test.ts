import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_BASE_URL = process.env.ROBOZIUM_API_BASE_URL;

async function importConfig() {
	vi.resetModules();
	return import("../../../lib/robozium/config");
}

afterEach(() => {
	if (ORIGINAL_BASE_URL === undefined) {
		delete process.env.ROBOZIUM_API_BASE_URL;
	} else {
		process.env.ROBOZIUM_API_BASE_URL = ORIGINAL_BASE_URL;
	}
});

describe("ROBOZIUM_API_BASE_URL", () => {
	it("uses the explicit environment variable", async () => {
		process.env.ROBOZIUM_API_BASE_URL = "http://api.test:8000";

		const config = await importConfig();

		expect(config.ROBOZIUM_API_BASE_URL).toBe("http://api.test:8000");
	});

	it("fails fast when the environment variable is missing", async () => {
		delete process.env.ROBOZIUM_API_BASE_URL;

		await expect(importConfig()).rejects.toThrow("ROBOZIUM_API_BASE_URL must be set");
	});

	it("fails fast when the environment variable is blank", async () => {
		process.env.ROBOZIUM_API_BASE_URL = " ";

		await expect(importConfig()).rejects.toThrow("ROBOZIUM_API_BASE_URL must be set");
	});
});
