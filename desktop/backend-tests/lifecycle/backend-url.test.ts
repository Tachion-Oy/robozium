import assert from "node:assert/strict"
import { test } from "node:test"
import { backendUrl } from "../../src/backend-url.ts"

test("a launch without --backend-url manages its own backend", () => {
	assert.equal(backendUrl(["electron", "."]), null)
})

test("a local HTTP origin with a port is accepted; localhost becomes 127.0.0.1", () => {
	assert.equal(backendUrl([".", "--backend-url=http://127.0.0.1:8000"]), "http://127.0.0.1:8000")
	assert.equal(backendUrl([".", "--backend-url=http://localhost:8000/"]), "http://127.0.0.1:8000")
})

test("any other address is refused", () => {
	for (const value of [
		"", "127.0.0.1:8000", "https://127.0.0.1:8000", "http://127.0.0.1", "http://example.com:8000",
		"http://[::1]:8000", "http://user:secret@127.0.0.1:8000", "http://127.0.0.1:8000/api",
		"http://127.0.0.1:8000/?debug", "http://127.0.0.1:8000/#hub",
	]) {
		assert.throws(() => backendUrl([`--backend-url=${value}`]), TypeError, value)
	}
})
