import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import { test } from "node:test"
import { stageBackend } from "../scripts/stage-backend.ts"
import { BackendController } from "../src/backend-controller.ts"
import { loadOrCreateBackendProfile } from "../src/backend-profile.ts"
import { platformEngine } from "../src/platform-engine.ts"

test("desktop mock image starts rootless and retains projects after restart, recreate and shutdown", { timeout: 900_000 }, async t => {
	const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-container-"))
	const profile = path.join(temporary, "profile with spaces")
	const source = path.join(temporary, "stage")
	const server = net.createServer()
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
	const port = (server.address() as net.AddressInfo).port
	await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
	const { project, runtime } = loadOrCreateBackendProfile(profile, "mock", String(port))
	const podman = (args: string[]) => execFileSync("podman", args, { encoding: "utf8", timeout: 60_000 })
	const controller = new BackendController({ profile, source, mode: "mock", port: String(port), engine: platformEngine() })

	let cleaned = false
	async function cleanup() {
		if (cleaned) return
		cleaned = true
		// Every step runs, so one failure cannot leave the others' containers or image behind.
		const failures: unknown[] = []
		for (const step of [
			() => controller.close(),
			() => {
				const ids = podman(["ps", "--all", "--quiet", "--filter", `label=fi.tachion.robozium.desktop.project=${project}`]).trim()
				if (ids) podman(["rm", "--force", ...ids.split(/\s+/)])
			},
			() => {
				// A failed build leaves no image. Untagging keeps the layers, which Podman would delete with the image, for the next build's cache.
				if (podman(["images", "--quiet", `localhost/${project}-api`]).trim()) podman(["untag", `localhost/${project}-api`])
			},
		]) {
			try { await step() } catch (error) { failures.push(error) }
		}
		if (failures.length > 0) throw failures[0]
	}
	const interrupted = async () => {
		try { await cleanup() } finally { process.exitCode = 1 }
	}
	process.once("SIGTERM", interrupted)
	process.once("SIGINT", interrupted)
	t.after(async () => {
		process.removeListener("SIGTERM", interrupted)
		process.removeListener("SIGINT", interrupted)
		await cleanup()
		fs.rmSync(temporary, { recursive: true, force: true })
	})
	fs.cpSync(stageBackend(), source, { recursive: true })
	for (const relative of [".env", ".env.encrypt", "local/imports/private.py", "src/robozium/.env", "src/robozium/private.txt"]) {
		const file = path.join(source, relative)
		fs.mkdirSync(path.dirname(file), { recursive: true })
		fs.writeFileSync(file, "SYNTHETIC_PRIVATE_SENTINEL=never-in-image\n")
	}

	const request = async (route: string, options?: RequestInit) => {
		const response = await globalThis.fetch(`http://127.0.0.1:${port}${route}`, { ...options, headers: { ...options?.headers, Origin: "robozium://app", Connection: "close" }, signal: globalThis.AbortSignal.timeout(10_000) })
		assert.equal(response.status, 200, await response.clone().text())
		return response.json()
	}
	try {
		await controller.start()
		await request("/ready")
		const created = await request("/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Desktop persistence" }) })
		assert.equal(created.slug, "desktop-persistence")
		const projectDirectory = path.join(runtime, "hub/projects", created.slug)
		assert.equal(fs.statSync(projectDirectory).uid, process.getuid!(), "files the backend creates belong to the user who runs the app")
		const marker = path.join(projectDirectory, "desktop-proof.txt")
		fs.writeFileSync(marker, "retained desktop data\n")
		podman(["run", "--rm", "--network", "none", "--entrypoint", "python", `localhost/${project}-api`, "-c", [
			"import os, pathlib, robozium",
			"assert os.getuid() == 10001",
			"assert not any('SYNTHETIC_PRIVATE_SENTINEL' in value for value in os.environ.values())",
			"package = pathlib.Path(robozium.__file__).parent",
			"private = [pathlib.Path('/app') / name for name in ('.env', '.env.encrypt', 'local')]",
			"private += [package / name for name in ('.env', 'private.txt')]",
			"present = [str(p) for p in private if p.exists()]",
			"assert not present, present",
		].join("; ")])
		await controller.restart()
		assert.ok((await request("/projects")).some((item: { slug: string }) => item.slug === created.slug))
		await controller.recreate()
		assert.ok((await request("/projects")).some((item: { slug: string }) => item.slug === created.slug))
		await cleanup()
		assert.equal(fs.readFileSync(marker, "utf8"), "retained desktop data\n")
	} catch (error) {
		// The build and start log, then the API's own output, which holds a Python traceback.
		for (const log of [() => fs.readFileSync(path.join(runtime, ".runtime/logs/container.log"), "utf8").slice(-20_000), () => podman(["logs", "--tail", "200", `${project}-api`])]) {
			try { process.stderr.write(log()) }
			catch { /* Preserve the original build or API failure. */ }
		}
		throw error
	}
})
