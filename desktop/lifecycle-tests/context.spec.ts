import { expect, test } from "@playwright/test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import http from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { BackendController } from "../src/backend-controller"
import { loadOrCreateBackendProfile } from "../src/backend-profile"
import { resolveBackendLayout } from "../src/backend-layout.cjs"
import { findDocker, runCommand, type CommandOptions } from "../src/docker-command"

async function checkedCommand(docker: string, args: string[], options: CommandOptions) {
	let output = ""
	try { return await runCommand(docker, args, { ...options, log: text => { output += text; options.log?.(text) } }) }
	catch (error) { throw new Error(`docker ${args.join(" ")}: ${output}`, { cause: error }) }
}

for (const phase of ["ready", "retry", "cancel"] as const) {
	test(`Docker context stays on the original daemon through ${phase} and shutdown`, async () => {
		const directory = await mkdtemp(path.join(tmpdir(), "robozium-context-"))
		const profile = path.join(directory, "profile"), config = path.join(directory, "docker")
		await mkdir(config)
		const build = "b".repeat(64), id = "a".repeat(12)
		await writeFile(path.join(directory, "build-id.json"), JSON.stringify({ id: build }))
		const settings = loadOrCreateBackendProfile(profile, "mock")
		const layout = resolveBackendLayout(settings.runtime)
		const environment = ["DOCKER_CONFIG", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH", "DOCKER_API_VERSION"]
		const originals = Object.fromEntries(environment.map(name => [name, process.env[name]]))
		for (const name of environment) delete process.env[name]
		process.env.DOCKER_CONFIG = config
		const docker = findDocker()!
		const cli = (args: string[]) => checkedCommand(docker, args, { cwd: directory, env: { ...process.env }, signal: AbortSignal.timeout(10_000) })
		const daemons = ["context-a", "context-b"].map(name => {
			const state = { running: false, exists: false, requests: [] as string[] }
			const server = http.createServer((request, response) => {
				const route = new URL(request.url!, "http://docker").pathname.replace(/^\/v[\d.]+/, "")
				state.requests.push(`${request.method} ${route}`)
				response.setHeader("Api-Version", "1.47")
				if (route === "/_ping") { response.end("OK"); return }
				response.setHeader("Content-Type", "application/json")
				if (route === "/info") response.end(JSON.stringify({ SecurityOptions: [] }))
				else if (route === "/containers/json") response.end(JSON.stringify(state.exists ? [{ Id: id }] : []))
				else if (route === `/containers/${id}/json`) response.end(JSON.stringify({
					Id: id, Config: { Labels: { "com.docker.compose.project": settings.project, "com.docker.compose.service": "api",
						"fi.tachion.robozium.desktop.installation": settings.installation, "fi.tachion.robozium.desktop.port": String(settings.port) } },
					State: { Running: state.running },
					Mounts: layout.mounts.map(mount => ({ Source: mount.source, Destination: mount.destination, RW: mount.writable })),
				}))
				else if (route === `/containers/${id}/stop`) { state.running = false; response.writeHead(204); response.end() }
				else { response.writeHead(404); response.end(JSON.stringify({ message: `Unexpected request: ${route}` })) }
			})
			return { name, state, server, socket: path.join(directory, `${name}.sock`) }
		})
		let controller: BackendController | undefined
		try {
			for (const daemon of daemons) {
				await new Promise<void>(resolve => daemon.server.listen(daemon.socket, resolve))
				await cli(["context", "create", daemon.name, "--docker", `host=unix://${daemon.socket}`])
			}
			await cli(["context", "use", "context-a"])
			let ready = phase === "ready"
			let reached: () => void = () => {}
			const polling = new Promise<void>(resolve => { reached = resolve })
			controller = new BackendController({ profile, source: directory, compose: path.join(directory, "compose.yaml"), mode: "mock",
				findDocker: () => docker, checkPort: async () => true, readinessTimeout: phase === "retry" ? 20 : 10_000, pollInterval: 1,
				run: async (executable, args, options) => {
					if (args[0] === "image") return build
					if (args[0] === "compose") {
						if (args[1] === "version") return "2.35.1"
						// Probe the Compose boundary with the same CLI environment before creating its simulated container.
						await checkedCommand(executable, ["info", "--format", "{{json .SecurityOptions}}"], options)
						const context = (await checkedCommand(executable, ["context", "show"], options)).trim()
						const daemon = daemons.find(daemon => daemon.name === context)!
						daemon.state.exists = daemon.state.running = true
						return ""
					}
					return checkedCommand(executable, args, options)
				},
				fetch: async (_url, init) => {
					reached()
					if (phase === "cancel") return new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }))
					return new Response(JSON.stringify({ status: ready ? "ready" : "starting" }))
				},
			})
			if (phase === "cancel") {
				const rejected = expect(controller.start()).rejects.toThrow(/abort|cancel/i)
				await polling
				await cli(["context", "use", "context-b"])
				await controller.close()
				await rejected
			} else {
				if (phase === "retry") await expect(controller.start()).rejects.toThrow(/readiness timed out/)
				else await controller.start()
				expect(daemons[0].state.running).toBe(true)
				await cli(["context", "use", "context-b"])
				if (phase === "retry") { ready = true; await controller.start() }
				await controller.close()
			}
			expect((await cli(["context", "show"])).trim()).toBe("context-b")
			expect(daemons[0].state.running).toBe(false)
			expect(daemons[0].state.requests).toContain(`POST /containers/${id}/stop`)
			expect(daemons[1].state.requests).toEqual([])
		} finally {
			try { await controller?.close() }
			finally {
				for (const daemon of daemons) {
					daemon.server.closeAllConnections()
					await new Promise<void>(resolve => daemon.server.close(() => resolve()))
				}
				for (const name of environment) {
					if (originals[name] === undefined) delete process.env[name]
					else process.env[name] = originals[name]
				}
				await rm(directory, { recursive: true, force: true })
			}
		}
	})
}
