import assert from "node:assert/strict"
import path from "node:path"
import { test } from "node:test"
import { desktopLocations } from "../../dist/locations.js"

const base = { appDirectory: "/repo/desktop/dist", resourcesPath: "/opt/Robozium/resources", userData: "/home/user/.config/Robozium", preview: false }

test("an installed app keeps its profile in the user's config directory and reads backend files from resources", () => {
	assert.deepEqual(desktopLocations({ ...base, packaged: true }), {
		profile: "/home/user/.config/Robozium",
		source: "/opt/Robozium/resources/backend/stage",
		compose: "/opt/Robozium/resources/backend/compose.yaml",
	})
	assert.equal(desktopLocations({ ...base, packaged: true, preview: true }).profile, "/home/user/.config/Robozium/preview")
})

test("a checkout keeps its own profile beside it and reads the staged backend from the checkout", () => {
	assert.deepEqual(desktopLocations({ ...base, packaged: false }), {
		profile: "/repo/.artifacts/desktop/data",
		source: "/repo/desktop/.stage/backend",
		compose: "/repo/desktop/compose.yaml",
	})
	assert.equal(desktopLocations({ ...base, packaged: false, preview: true }).profile, "/repo/.artifacts/desktop/scaffold")
})

test("an explicit profile wins in both, resolved to an absolute path", () => {
	for (const packaged of [true, false]) {
		assert.equal(desktopLocations({ ...base, packaged, profileOverride: "relative/profile" }).profile, path.resolve("relative/profile"))
		assert.equal(desktopLocations({ ...base, packaged, profileOverride: "/shared/dev" }).profile, "/shared/dev")
	}
})
