import assert from "node:assert/strict"
import path from "node:path"
import { test } from "node:test"
import { desktopLocations, expandHome } from "../../src/locations.ts"

const base = { appDirectory: "/repo/desktop/dist", resourcesPath: "/opt/Robozium/resources", userData: "/home/user/.config/Robozium", home: "/home/user", mode: "live" as const }

test("an installed app keeps its profile in the user's config directory and reads backend files from resources", () => {
	assert.deepEqual(desktopLocations({ ...base, packaged: true }), {
		profile: "/home/user/.config/Robozium",
		source: "/opt/Robozium/resources/backend/stage",
		preload: "/repo/desktop/dist/preload.cjs",
		renderer: "/repo/desktop/dist/renderer",
		hubFolder: {
			file: "/home/user/.config/Robozium/hub-folder", defaultFolder: "/home/user/Robozium-Hub",
			earlierFolder: "/home/user/.config/Robozium/live/hub",
		},
	})
})

test("a checkout keeps its own profile beside it and reads the staged backend from the checkout", () => {
	const checkout = desktopLocations({ ...base, packaged: false })
	assert.deepEqual([checkout.profile, checkout.source], ["/repo/.artifacts/desktop/data", "/repo/desktop/.stage/backend"])
})

test("an explicit profile wins in both, resolved to an absolute path", () => {
	for (const packaged of [true, false]) {
		assert.equal(desktopLocations({ ...base, packaged, profileOverride: "relative/profile" }).profile, path.resolve("relative/profile"))
		assert.equal(desktopLocations({ ...base, packaged, profileOverride: "/shared/dev" }).profile, "/shared/dev")
	}
})

test("every live launch can choose its hub; only an installed app defaults to ~/Robozium-Hub", () => {
	assert.deepEqual(desktopLocations({ ...base, packaged: false }).hubFolder, {
		file: "/repo/.artifacts/desktop/data/hub-folder", defaultFolder: "/repo/.artifacts/desktop/data/live/hub", earlierFolder: null,
	})
	assert.deepEqual(desktopLocations({ ...base, packaged: true, profileOverride: "/tests/profile" }).hubFolder, {
		file: "/tests/profile/hub-folder", defaultFolder: "/tests/profile/live/hub", earlierFolder: null,
	})
	for (const packaged of [true, false]) {
		assert.equal(desktopLocations({ ...base, packaged, mode: "mock" }).hubFolder, null, `packaged: ${packaged}`)
	}
})

test("a leading ~/ starts from the home directory; other locations are kept", () => {
	assert.equal(expandHome("~/Robozium-Hub", "/home/user"), "/home/user/Robozium-Hub")
	assert.equal(expandHome("/data/hub", "/home/user"), "/data/hub")
	assert.equal(expandHome("~other/hub", "/home/user"), "~other/hub")
})
