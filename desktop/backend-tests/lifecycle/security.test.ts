import assert from "node:assert/strict"
import { test } from "node:test"
import { droppedFolderReadAllowed } from "../../src/security.ts"

const documentUrl = "robozium://app/index.html"

test("the app's own page may read a folder the user dropped, as Electron checks it without a frame", () => {
	for (const origin of ["robozium://app", "robozium://app/"]) {
		assert.equal(droppedFolderReadAllowed(documentUrl, "fileSystem", origin, { fileAccessType: "readable" }), true, origin)
	}
})

test("writing, other origins and other permissions stay refused", () => {
	assert.equal(droppedFolderReadAllowed(documentUrl, "fileSystem", "robozium://app", { fileAccessType: "writable" }), false)
	assert.equal(droppedFolderReadAllowed(documentUrl, "fileSystem", "robozium://app", {}), false)
	for (const origin of ["https://example.com", "robozium://other", "http://app", "not a url", ""]) {
		assert.equal(droppedFolderReadAllowed(documentUrl, "fileSystem", origin, { fileAccessType: "readable" }), false, origin)
	}
	assert.equal(droppedFolderReadAllowed(documentUrl, "media", "robozium://app", { fileAccessType: "readable" }), false)
})
