import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import { test, type TestContext } from "node:test"
import { pathToFileURL } from "node:url"
import { stageBackend } from "../scripts/stage-backend.ts"

const desktop = path.resolve(import.meta.dirname, "..")
interface LayoutMount { source: string; target: string }

function fixture(t: TestContext) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-backend-"))
	t.after(() => fs.rmSync(root, { recursive: true, force: true }))
	for (const directory of ["desktop/scripts", "desktop/src", "src/robozium/nested", "private", "local/imports", ".runtime", ".artifacts"]) {
		fs.mkdirSync(path.join(root, directory), { recursive: true })
	}
	for (const name of ["Dockerfile", ".dockerignore", "package.json", "scripts/stage-backend.ts", "src/backend-layout.json", "src/backend-layout.ts", "src/host-endpoints.ts"]) {
		fs.copyFileSync(path.join(desktop, name), path.join(root, "desktop", name))
	}
	for (const name of ["hub.config.py", "pyproject.toml", "uv.lock", "README.md", "LICENSE", "CHANGELOG.md", "src/robozium/__init__.py", "src/robozium/nested/module.py"]) {
		fs.writeFileSync(path.join(root, name), `# public ${name}\n`)
	}
	for (const name of [".env", ".env.encrypt", "private/key.py", "local/imports/private.py", ".runtime/data", ".artifacts/data", "src/robozium/.env", "src/robozium/cache.pyc"]) {
		fs.writeFileSync(path.join(root, name), "SYNTHETIC_PRIVATE_SENTINEL\n")
	}
	return root
}

test("staging copies only public inputs, and replaces stale output", t => {
	const root = fixture(t)
	execFileSync(process.execPath, [path.join(root, "desktop/scripts/stage-backend.ts")], { cwd: os.tmpdir() })
	const target = stageBackend(root)
	const files = fs.readdirSync(target, { recursive: true, encoding: "utf8" }).filter(name => fs.statSync(path.join(target, name)).isFile()).sort()
	assert.deepEqual(files, [".dockerignore", "CHANGELOG.md", "Dockerfile", "LICENSE", "README.md", "build-id.json", "hub.config.py", "pyproject.toml", "src/robozium/__init__.py", "src/robozium/nested/module.py", "uv.lock"])
	for (const file of files) assert.doesNotMatch(fs.readFileSync(path.join(target, file), "utf8"), /SYNTHETIC_PRIVATE_SENTINEL/)
	const build = JSON.parse(fs.readFileSync(path.join(target, "build-id.json"), "utf8")).id
	assert.match(build, /^[a-f0-9]{64}$/)
	stageBackend(root)
	assert.equal(JSON.parse(fs.readFileSync(path.join(target, "build-id.json"), "utf8")).id, build)
	fs.appendFileSync(path.join(root, "src/robozium/nested/module.py"), "# changed source\n")
	stageBackend(root)
	assert.notEqual(JSON.parse(fs.readFileSync(path.join(target, "build-id.json"), "utf8")).id, build)
	fs.writeFileSync(path.join(target, "stale-secret"), "old")
	stageBackend(root)
	assert.equal(fs.existsSync(path.join(target, "stale-secret")), false)
})

for (const source of ["README.md", "src", "src/robozium/nested", "src/robozium/nested/module.py", "desktop", "desktop/.stage", "desktop/.stage/backend"]) {
	test(`staging rejects a symlink at ${source} without touching its target`, t => {
		const root = fixture(t)
		const linked = path.join(root, source)
		const destination = path.join(root, "private/destination")
		if (fs.existsSync(linked)) fs.renameSync(linked, destination)
		else fs.mkdirSync(destination)
		fs.mkdirSync(path.dirname(linked), { recursive: true })
		fs.symlinkSync(destination, linked)
		assert.throws(() => stageBackend(root), /rejects symlinks/)
		assert.ok(fs.existsSync(destination))
		assert.equal(fs.readFileSync(path.join(root, "private/key.py"), "utf8"), "SYNTHETIC_PRIVATE_SENTINEL\n")
	})
}

/** The fixture's own layout module, so a changed layout file takes effect. */
async function fixtureLayout(root: string): Promise<typeof import("../src/backend-layout.ts")> {
	return import(pathToFileURL(path.join(root, "desktop/src/backend-layout.ts")).href)
}

test("the layout mounts the runtime and hub, with only the socket and safe scripts read-only", async t => {
	const root = fixture(t)
	const runtime = path.join(root, "live data with spaces")
	const { resolveBackendLayout } = await fixtureLayout(root)
	const layout = resolveBackendLayout(runtime)
	const sources: Record<string, string> = {
		"/configuration": "", "/app/local": "local", "/app/.runtime/local-deps": ".runtime/local-deps",
		"/hub": "hub", "/logs": ".runtime/logs", "/host-scripts": ".runtime/host-socket",
		"/hub/readonly/safe-scripts": "hub/readonly/safe-scripts",
	}
	assert.deepEqual(Object.fromEntries(layout.mounts.map(mount => [mount.destination, mount.source])),
		Object.fromEntries(Object.entries(sources).map(([destination, source]) => [destination, path.join(runtime, source)])))
	assert.deepEqual(layout.mounts.filter(mount => !mount.writable).map(mount => mount.destination).sort(), ["/host-scripts", "/hub/readonly/safe-scripts"])
})

test("runtime preparation follows relocated paths from the shared layout", async t => {
	const root = fixture(t)
	const runtime = path.join(root, "relocated runtime with spaces")
	const configuration = path.join(root, "desktop/src/backend-layout.json")
	const definition = JSON.parse(fs.readFileSync(configuration, "utf8"))
	definition.services.api.volumes.find((mount: LayoutMount) => mount.target === "/logs").source = "${ROBOZIUM_DESKTOP_RUNTIME}/diagnostics"
	definition.services.api.volumes.find((mount: LayoutMount) => mount.target === "/app/local").source = "${ROBOZIUM_DESKTOP_RUNTIME}/extensions"
	definition["x-desktop"].containerLog.filename = "engine.log"
	fs.writeFileSync(configuration, JSON.stringify(definition))

	const { resolveBackendLayout, prepareBackendRuntime } = await fixtureLayout(root)
	const layout = resolveBackendLayout(runtime)
	prepareBackendRuntime(layout)
	assert.deepEqual(fs.readdirSync(path.join(runtime, "extensions")), [], "the hub owns local package directories")
	assert.deepEqual(fs.readdirSync(path.join(runtime, "hub"), { recursive: true }).sort(), [
		"readonly", "readonly/safe-scripts",
	], "only the nested read-only mount needs preparation inside the hub")
	assert.equal(fs.existsSync(path.join(runtime, "local")), false)
	assert.equal(fs.existsSync(path.join(runtime, ".runtime/logs")), false)
	assert.equal(layout.containerLog, path.join(runtime, "diagnostics/engine.log"))
	for (const mount of layout.mounts) {
		assert.equal(fs.statSync(mount.source).isDirectory(), true)
		assert.equal(fs.statSync(mount.source).mode & 0o777, 0o700)
	}
})

test("the layout refuses a relative runtime or hub instead of mounting a guess", async t => {
	const { resolveBackendLayout } = await fixtureLayout(fixture(t))
	assert.throws(() => resolveBackendLayout("relative"), /Select an absolute desktop runtime directory/)
	assert.throws(() => resolveBackendLayout("/runtime", "relative"), /Select an absolute hub folder/)
})

test("runtime preparation never creates a user's hub folder outside the runtime", async t => {
	const root = fixture(t)
	const runtime = path.join(root, "runtime")
	const hub = path.join(root, "Robozium-Hub")
	const { resolveBackendLayout, prepareBackendRuntime } = await fixtureLayout(root)
	const prepare = () => prepareBackendRuntime(resolveBackendLayout(runtime, hub))
	assert.throws(prepare, /Hub folder .* is missing/)
	assert.equal(fs.existsSync(hub), false)
	fs.mkdirSync(hub)
	prepare()
	assert.deepEqual(fs.readdirSync(hub, { recursive: true }).sort(), ["readonly", "readonly/safe-scripts"])
	assert.equal(fs.existsSync(path.join(runtime, "hub")), false, "the runtime keeps no hub of its own beside the user's")
})
