import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import { test } from "node:test"
import { stageBackend } from "../scripts/stage-backend.mjs"

const desktop = path.resolve(import.meta.dirname, "..")
function fixture(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-backend-"))
	t.after(() => fs.rmSync(root, { recursive: true, force: true }))
	for (const directory of ["desktop/scripts", "src/robozium/nested", "private", "local/imports", ".runtime", ".artifacts"]) {
		fs.mkdirSync(path.join(root, directory), { recursive: true })
	}
	for (const name of ["Dockerfile", ".dockerignore", "hub.config.py", "compose.yaml", "scripts/stage-backend.mjs"]) {
		fs.copyFileSync(path.join(desktop, name), path.join(root, "desktop", name))
	}
	for (const name of ["pyproject.toml", "uv.lock", "README.md", "LICENSE", "CHANGELOG.md", "src/robozium/__init__.py", "src/robozium/nested/module.py"]) {
		fs.writeFileSync(path.join(root, name), `# public ${name}\n`)
	}
	for (const name of [".env", ".env.encrypt", "private/key.py", "local/imports/private.py", ".runtime/data", ".artifacts/data", "src/robozium/.env", "src/robozium/cache.pyc"]) {
		fs.writeFileSync(path.join(root, name), "SYNTHETIC_PRIVATE_SENTINEL\n")
	}
	return root
}

test("staging works without web, copies only public inputs, and replaces stale output", t => {
	const root = fixture(t)
	assert.equal(fs.existsSync(path.join(root, "web")), false)
	execFileSync(process.execPath, [path.join(root, "desktop/scripts/stage-backend.mjs")], { cwd: os.tmpdir() })
	const target = stageBackend(root)
	const files = fs.readdirSync(target, { recursive: true }).filter(name => fs.statSync(path.join(target, name)).isFile()).sort()
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

function compose(root, runtime, overrides = {}) {
	const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(COMPOSE_|ROBOZIUM_)/.test(name)))
	return spawnSync("docker", ["compose", "--project-name", "desktop-config-test", "--env-file", path.join(root, "empty.env"), "--file", path.join(root, "desktop/compose.yaml"), "config", "--format", "json"], {
		env: { ...env, ...(runtime ? { ROBOZIUM_DESKTOP_RUNTIME: runtime } : {}), ...overrides },
		cwd: root, encoding: "utf8", timeout: 15_000,
	})
}

for (const [mode, port, user, overrides] of [
	["live", "18001", "10001:10001", {}],
	["mock", "18000", "1234:5678", { ROBOZIUM_MODE: "mock", ROBOZIUM_DESKTOP_API_PORT: "18000", ROBOZIUM_API_USER: "1234:5678" }],
	["live", "29501", "0:0", { ROBOZIUM_MODE: "live", ROBOZIUM_DESKTOP_API_PORT: "29501", ROBOZIUM_API_USER: "0:0" }],
]) {
	test(`Compose isolates ${mode} on ${port} with user ${user}`, t => {
		const root = fixture(t)
		const runtime = path.join(root, `${mode} data with spaces`)
		fs.mkdirSync(runtime)
		fs.writeFileSync(path.join(root, "empty.env"), "# no interpolation credentials\n")
		fs.writeFileSync(path.join(root, "desktop/.env"), "ROBOZIUM_MODE=wrong\nROBOZIUM_DESKTOP_API_PORT=9999\n")
		fs.writeFileSync(path.join(runtime, ".env.encrypt"), "OPENROUTER_API_KEY_ENCRYPTED=roboz:synthetic\nEXAMPLE_VALUE=encrypted-copy\n")
		fs.writeFileSync(path.join(runtime, ".env"), "EXAMPLE_VALUE=plain-copy\nROBOZIUM_CONFIG=/wrong\nROBOZIUM_HUB_ROOT=/wrong\n")
		const result = compose(root, runtime, overrides)
		assert.equal(result.status, 0, result.stderr)
		const { services } = JSON.parse(result.stdout)
		assert.deepEqual(Object.keys(services), ["api"])
		const api = services.api
		assert.equal(api.network_mode, "host")
		assert.equal(api.ports, undefined)
		assert.equal(api.build.context, path.join(root, "desktop/.stage/backend"))
		assert.equal(api.build.target, "api")
		assert.equal(api.user, user)
		assert.equal(api.init, true)
		assert.equal(api.stop_grace_period, "30s")
		assert.deepEqual(api.command, ["uvicorn", `robozium.api.app:${mode}_app`, "--factory", "--host", "127.0.0.1", "--port", port, "--workers", "1"])
		assert.equal(api.environment.ROBOZIUM_DESKTOP_API_PORT, port)
		assert.equal(api.environment.ROBOZIUM_MODE, mode)
		assert.equal(api.environment.EXAMPLE_VALUE, "plain-copy")
		assert.equal(api.environment.OPENROUTER_API_KEY_ENCRYPTED, "roboz:synthetic")
		assert.equal(api.environment.ROBOZIUM_CONFIG, "/app/hub.config.py")
		assert.equal(api.environment.ROBOZIUM_HUB_ROOT, "/hub")
		assert.equal(api.environment.ROBOZIUM_LOG_DIR, "/logs")
		assert.equal(api.environment.ROBOZIUM_ENCRYPTED_ENV_PATH, "/configuration/.env.encrypt")
		assert.equal(api.environment.ROBOZIUM_HOST_SCRIPT_SOCKET, "/host-scripts/scripts.sock")
		assert.match(api.healthcheck.test.at(-1), /127\.0\.0\.1:.*ROBOZIUM_DESKTOP_API_PORT.*\/ready/)
		assert.equal(api.healthcheck.start_period, "3m0s")
		assert.equal(api.healthcheck.retries, 12)
		const sources = {
			"/configuration": "", "/app/local": "local", "/app/.runtime/local-deps": ".runtime/local-deps",
			"/hub": "hub", "/logs": ".runtime/logs", "/host-scripts": ".runtime/host-socket",
			"/hub/readonly/safe-scripts": "hub/readonly/safe-scripts",
		}
		assert.equal(api.volumes.length, Object.keys(sources).length)
		for (const mount of api.volumes) {
			assert.equal(mount.type, "bind")
			assert.equal(mount.source, path.join(runtime, sources[mount.target]))
			assert.equal(mount.bind?.create_host_path ?? false, false)
			assert.equal(Boolean(mount.read_only), ["/host-scripts", "/hub/readonly/safe-scripts"].includes(mount.target))
		}
		fs.rmSync(path.join(runtime, ".env"))
		fs.rmSync(path.join(runtime, ".env.encrypt"))
		assert.equal(compose(root, runtime, overrides).status, 0, "credential files are optional")
	})
}

test("Compose refuses an unspecified runtime instead of mounting the checkout", t => {
	const root = fixture(t)
	fs.writeFileSync(path.join(root, "empty.env"), "")
	const result = compose(root)
	assert.notEqual(result.status, 0)
	assert.match(result.stderr, /Select an absolute desktop runtime directory/)
})
