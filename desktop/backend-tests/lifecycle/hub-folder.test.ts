import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import process from "node:process"
import { test, type TestContext } from "node:test"
import { checkHubFolderChoice, HubFolderError, recordedHubFolder, resolveHubFolder } from "../../src/hub-folder.ts"

function fixture(t: TestContext) {
	const directory = mkdtempSync(path.join(tmpdir(), "robozium-hub-folder-"))
	t.after(() => rmSync(directory, { recursive: true, force: true }))
	const profile = path.join(directory, "profile")
	mkdirSync(profile)
	const location = { file: path.join(profile, "hub-folder"), defaultFolder: path.join(directory, "home/Robozium-Hub"), earlierFolder: path.join(profile, "live/hub") }
	// Choices are checked against a temporary folder of their own, so the fixture itself is not one.
	const temporary = path.join(directory, "tmp")
	mkdirSync(temporary)
	return { directory, profile, location, temporary }
}

test("with nothing chosen, the default is created once and not recorded", t => {
	const { profile, location } = fixture(t)
	assert.equal(resolveHubFolder(location, profile), location.defaultFolder)
	assert.equal(existsSync(location.file), false)
	writeFileSync(path.join(location.defaultFolder, "kept.txt"), "kept")
	assert.equal(resolveHubFolder(location, profile), location.defaultFolder)
	assert.equal(readFileSync(path.join(location.defaultFolder, "kept.txt"), "utf8"), "kept")
})

test("projects left in an earlier version's hub stop startup instead of starting empty", t => {
	const { profile, location } = fixture(t)
	mkdirSync(path.join(location.earlierFolder, "readonly"), { recursive: true })
	assert.equal(resolveHubFolder(location, profile), location.defaultFolder, "an earlier hub without projects is no obstacle")
	mkdirSync(path.join(location.earlierFolder, "projects/notes"), { recursive: true })
	assert.throws(() => resolveHubFolder(location, profile), error => error instanceof HubFolderError
		&& error.message.includes(location.earlierFolder) && error.message.includes(location.defaultFolder))
	assert.equal(existsSync(location.file), false)
	assert.ok(existsSync(path.join(location.earlierFolder, "projects/notes")), "earlier projects are left where they are")
})

test("a checkout's default may lie in its own data, and the earlier-hub check is skipped", t => {
	const { profile, location } = fixture(t)
	const runtimeHub = path.join(profile, "live/hub")
	mkdirSync(path.join(runtimeHub, "projects/scratch"), { recursive: true })
	assert.equal(resolveHubFolder({ ...location, defaultFolder: runtimeHub, earlierFolder: null }, profile), runtimeHub)
})

test("a recorded folder that is missing stops startup and is never recreated", t => {
	const { directory, profile, location } = fixture(t)
	const chosen = path.join(directory, "drive/Hub")
	writeFileSync(location.file, chosen + "\n")
	assert.throws(() => resolveHubFolder(location, profile), error => error instanceof HubFolderError && /missing/.test(error.message))
	assert.equal(existsSync(chosen), false)
	assert.equal(existsSync(location.defaultFolder), false, "the default never stands in for a recorded folder")
})

test("an unreadable or relative record stops startup instead of falling back", t => {
	const { profile, location } = fixture(t)
	writeFileSync(location.file, "../Robozium-Hub\n")
	assert.throws(() => resolveHubFolder(location, profile), /absolute/)
	rmSync(location.file)
	mkdirSync(location.file)
	assert.throws(() => resolveHubFolder(location, profile), /cannot be read/)
	assert.equal(recordedHubFolder(location), null)
	assert.equal(existsSync(location.defaultFolder), false)
})

test("a hub overlapping the app's data folder is refused either way round", t => {
	const { directory, profile, location } = fixture(t)
	const inside = path.join(profile, "live/hub")
	mkdirSync(inside, { recursive: true })
	writeFileSync(location.file, inside)
	assert.throws(() => resolveHubFolder(location, profile), /overlaps/)
	writeFileSync(location.file, directory)
	assert.throws(() => resolveHubFolder(location, profile), /overlaps/)
	const link = path.join(directory, "linked-profile")
	symlinkSync(profile, link)
	writeFileSync(location.file, link)
	assert.throws(() => resolveHubFolder(location, profile), /overlaps/, "symlinks are resolved first")
})

test("a folder that cannot be written is refused", { skip: process.getuid?.() === 0 }, t => {
	const { directory, profile, location } = fixture(t)
	const locked = path.join(directory, "locked")
	mkdirSync(locked)
	chmodSync(locked, 0o500)
	writeFileSync(location.file, locked)
	try {
		assert.throws(() => resolveHubFolder(location, profile), /read and written/)
	} finally {
		chmodSync(locked, 0o700)
	}
})

test("choices must be existing folders outside app data and temporary folders", t => {
	const { directory, profile, temporary } = fixture(t)
	assert.throws(() => checkHubFolderChoice("relative/hub", profile, temporary), /absolute/)
	assert.throws(() => checkHubFolderChoice(path.join(directory, "absent"), profile, temporary), /missing/)
	writeFileSync(path.join(directory, "file"), "")
	assert.throws(() => checkHubFolderChoice(path.join(directory, "file"), profile, temporary), /not a folder/)
	assert.throws(() => checkHubFolderChoice(profile, profile, temporary), /overlaps/)
	mkdirSync(path.join(temporary, "hub"))
	assert.throws(() => checkHubFolderChoice(path.join(temporary, "hub"), profile, temporary), /temporary/)
})

test("a non-empty folder without projects needs confirming; an empty one or an existing hub does not", t => {
	const { directory, profile, temporary } = fixture(t)
	const empty = path.join(directory, "empty")
	const hub = path.join(directory, "hub")
	const parent = path.join(directory, "documents")
	for (const folder of [empty, path.join(hub, "projects"), parent]) mkdirSync(folder, { recursive: true })
	writeFileSync(path.join(parent, "notes.txt"), "")
	assert.deepEqual(checkHubFolderChoice(empty, profile, temporary), { folder: empty, needsConfirmation: false })
	assert.deepEqual(checkHubFolderChoice(hub, profile, temporary), { folder: hub, needsConfirmation: false })
	assert.deepEqual(checkHubFolderChoice(parent, profile, temporary), { folder: parent, needsConfirmation: true })
})
