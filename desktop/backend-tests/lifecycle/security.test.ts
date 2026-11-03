import assert from "node:assert/strict"
import { test } from "node:test"
import type { WebContents } from "electron"
import { droppedFolderReadAllowed } from "../../src/security.ts"

const documentUrl = "robozium://app/index.html"
const read = { fileAccessType: "readable", filePath: "/home/user/tool" }

test("the app's own page may read a folder the user dropped, as Electron checks it without a frame", () => {
	for (const origin of ["robozium://app", "robozium://app/"]) {
		assert.equal(droppedFolderReadAllowed(documentUrl, null, "fileSystem", origin, read), true, origin)
	}
})

test("writing, a check with a frame, a missing path, other origins and other permissions stay refused", () => {
	assert.equal(droppedFolderReadAllowed(documentUrl, null, "fileSystem", "robozium://app", { ...read, fileAccessType: "writable" }), false)
	assert.equal(droppedFolderReadAllowed(documentUrl, null, "fileSystem", "robozium://app", { filePath: read.filePath }), false)
	assert.equal(droppedFolderReadAllowed(documentUrl, null, "fileSystem", "robozium://app", { fileAccessType: "readable" }), false)
	assert.equal(droppedFolderReadAllowed(documentUrl, {} as WebContents, "fileSystem", "robozium://app", read), false)
	for (const origin of ["https://example.com", "robozium://other", "http://app", "not a url", ""]) {
		assert.equal(droppedFolderReadAllowed(documentUrl, null, "fileSystem", origin, read), false, origin)
	}
	assert.equal(droppedFolderReadAllowed(documentUrl, null, "media", "robozium://app", read), false)
})
