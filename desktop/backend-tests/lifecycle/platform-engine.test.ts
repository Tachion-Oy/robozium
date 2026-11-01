import assert from "node:assert/strict"
import { test } from "node:test"
import { platformEngine } from "../../src/platform-engine.ts"

test("Linux runs the backend with Podman", () => {
	assert.equal(platformEngine("linux").name, "Podman")
})

for (const [platform, os] of [["darwin", "macOS"], ["win32", "Windows"]] as const) {
	test(`${os} fails at the first step with a message the startup screen shows`, async () => {
		await assert.rejects(platformEngine(platform).prepare({ signal: new globalThis.AbortController().signal }), { message: `Robozium does not support ${os} yet.` })
	})
}
