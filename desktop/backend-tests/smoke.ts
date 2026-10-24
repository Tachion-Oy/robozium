import assert from "node:assert/strict"
import { execFileSync, type StdioOptions } from "node:child_process"
import { randomUUID } from "node:crypto"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import { test } from "node:test"
import { stageBackend } from "../scripts/stage-backend.ts"
import * as layout from "../src/backend-layout.ts"

test("desktop mock image starts independently and retains projects after restart and shutdown", { timeout: 600_000 }, async t => {
	const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-docker-"))
	const project = `robozium-desktop-test-${randomUUID().slice(0, 12)}`
	const runtime = path.join(temporary, "mock data")
	const desktop = path.resolve(import.meta.dirname, "..")
	const server = net.createServer()
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
	const port = (server.address() as net.AddressInfo).port
	await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
	const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(COMPOSE_|ROBOZIUM_)/.test(name)))
	const security = execFileSync("docker", ["info", "--format", "{{json .SecurityOptions}}"], { encoding: "utf8" })
	const env = { ...inherited, ROBOZIUM_MODE: "mock", ROBOZIUM_DESKTOP_API_PORT: String(port), ROBOZIUM_DESKTOP_RUNTIME: runtime,
		ROBOZIUM_DESKTOP_HUB: path.join(runtime, "hub"),
		ROBOZIUM_API_USER: security.includes("rootless") ? "0:0" : `${process.getuid!()}:${process.getgid!()}` }
	const args = ["compose", "--project-name", project, "--env-file", path.join(temporary, "empty.env"), "--file", path.join(temporary, "compose.yaml")]
	const compose = (command: string[], stdio: StdioOptions = "pipe") => execFileSync("docker", [...args, ...command], { env, cwd: temporary, encoding: "utf8", stdio, timeout: 540_000 })
	let cleaned = false
	function cleanup() {
		if (cleaned) return
		compose(["down", "--remove-orphans", "--rmi", "local"], "inherit")
		cleaned = true
	}
	const interrupted = () => {
		try { cleanup() } finally { process.exitCode = 1 }
	}
	process.once("SIGTERM", interrupted)
	process.once("SIGINT", interrupted)
	t.after(() => {
		process.removeListener("SIGTERM", interrupted)
		process.removeListener("SIGINT", interrupted)
		cleanup()
		fs.rmSync(temporary, { recursive: true, force: true })
	})
	fs.writeFileSync(path.join(temporary, "empty.env"), "# isolated interpolation\n")
	fs.copyFileSync(path.join(desktop, "compose.yaml"), path.join(temporary, "compose.yaml"))
	fs.mkdirSync(path.join(temporary, "src"))
	fs.copyFileSync(path.join(desktop, "src/backend-layout.json"), path.join(temporary, "src/backend-layout.json"))
	fs.cpSync(stageBackend(), path.join(temporary, ".stage/backend"), { recursive: true })
	for (const relative of [".env", ".env.encrypt", "local/imports/private.py", "src/robozium/.env", "src/robozium/private.txt"]) {
		const file = path.join(temporary, ".stage/backend", relative)
		fs.mkdirSync(path.dirname(file), { recursive: true })
		fs.writeFileSync(file, "SYNTHETIC_PRIVATE_SENTINEL=never-in-image\n")
	}
	layout.prepareBackendRuntime(layout.resolveBackendLayout(runtime))
	assert.deepEqual(fs.readdirSync(path.join(runtime, "local")), [])
	assert.equal(fs.existsSync(path.join(runtime, "hub/projects")), false)

	const request = async (route: string, options?: RequestInit) => {
		const response = await globalThis.fetch(`http://127.0.0.1:${port}${route}`, { ...options, headers: { ...options?.headers, Origin: "robozium://app", Connection: "close" }, signal: globalThis.AbortSignal.timeout(10_000) })
		assert.equal(response.status, 200, await response.clone().text())
		return response.json()
	}
	try {
		compose(["up", "--build", "--wait", "--wait-timeout", "180"], "inherit")
		const containers = JSON.parse(compose(["ps", "--format", "json"]))
		assert.equal(containers.Service, "api")
		assert.equal(containers.Health, "healthy")
		await request("/ready")
		const created = await request("/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Desktop persistence" }) })
		assert.equal(created.slug, "desktop-persistence")
		const marker = path.join(runtime, "hub/projects", created.slug, "desktop-proof.txt")
		fs.writeFileSync(marker, "retained desktop data\n")
		const image = compose(["images", "--quiet", "api"]).trim()
		execFileSync("docker", ["run", "--rm", "--network", "none", "--entrypoint", "python", image, "-c", [
			"import os, pathlib, robozium",
			"assert os.getuid() == 10001",
			"assert not any('SYNTHETIC_PRIVATE_SENTINEL' in value for value in os.environ.values())",
			"package = pathlib.Path(robozium.__file__).parent",
			"private = [pathlib.Path('/app') / name for name in ('.env', '.env.encrypt', 'local')]",
			"private += [package / name for name in ('.env', 'private.txt')]",
			"present = [str(p) for p in private if p.exists()]",
			"assert not present, present",
		].join("; ")], { encoding: "utf8", timeout: 30_000 })
		compose(["restart", "api"], "inherit")
		compose(["up", "--wait", "--wait-timeout", "180"], "inherit")
		assert.ok((await request("/projects")).some((item: { slug: string }) => item.slug === created.slug))
		assert.equal(fs.readFileSync(marker, "utf8"), "retained desktop data\n")
		cleanup()
		assert.equal(fs.readFileSync(marker, "utf8"), "retained desktop data\n")
	} catch (error) {
		try { compose(["logs", "--no-color", "--tail", "200", "api"], "inherit") }
		catch { /* Preserve the original build or API failure. */ }
		throw error
	}
})
