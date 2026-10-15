import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import net from "node:net"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import type { BackendStatus } from "./bridge"
import { backendProfile } from "./backend-profile"
import { findDocker, runCommand, type CommandOptions } from "./backend-process"

interface Options {
	profile: string; source: string; compose: string; mode: "live" | "mock"; port?: string
	run?: typeof runCommand; findDocker?: typeof findDocker; fetch?: typeof fetch
	checkPort?: typeof portAvailable; readinessTimeout?: number; pollInterval?: number
}
interface Container {
	labels: Record<string, string>; running: boolean
	mounts: { Source: string; Destination: string; RW: boolean }[]
}
export function portAvailable(port: number): Promise<boolean> {
	return new Promise((resolve, reject) => {
		const server = net.createServer()
		server.once("error", error => (error as NodeJS.ErrnoException).code === "EADDRINUSE" ? resolve(false) : reject(error))
		server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)))
	})
}

/** API-only adaptation of the ownership and cancellation boundaries in experiment 076b2c9. */
export class BackendController {
	private status: BackendStatus = { state: "starting", message: "Checking Docker…" }
	private pending?: Promise<void>
	private shutdown?: Promise<void>
	private abort = new AbortController()
	private closing = false
	private verified = false
	private docker = ""
	private env: NodeJS.ProcessEnv = {}
	private targetPinned = false
	private readonly settings: ReturnType<typeof backendProfile>
	private readonly run: typeof runCommand
	constructor(private readonly options: Options) {
		this.settings = backendProfile(options.profile, options.mode, options.port)
		this.run = options.run ?? runCommand
	}
	snapshot(): BackendStatus { return { ...this.status } }
	private command(args: string[], overrides: Partial<CommandOptions> = {}) {
		return this.run(this.docker, args, { cwd: this.settings.runtime, env: this.env, signal: this.abort.signal, ...overrides })
	}
	private compose(args: string[], overrides: Partial<CommandOptions> = {}) {
		return this.command(["compose", "--project-name", this.settings.project, "--env-file",
			path.join(this.settings.runtime, ".runtime/compose.env"), "--file", this.options.compose, ...args], overrides)
	}
	private async ownedContainers(overrides: Partial<CommandOptions> = {}) {
		const { project, installation, runtime, port } = this.settings
		const output = await this.command(["ps", "--all", "--quiet", "--filter", `label=com.docker.compose.project=${project}`], overrides)
		const ids = output.trim() ? output.trim().split(/\s+/) : []
		const containers: { id: string; running: boolean }[] = []
		for (const id of ids) {
			if (!/^[a-f0-9]{12,64}$/.test(id)) throw new Error("Invalid Docker container identity.")
			const value: Container = JSON.parse(await this.command(["inspect", "--format",
				'{"labels":{{json .Config.Labels}},"mounts":{{json .Mounts}},"running":{{.State.Running}}}', id], overrides))
			const expected = { "com.docker.compose.project": project, "com.docker.compose.service": "api",
				"fi.tachion.robozium.desktop.installation": installation, "fi.tachion.robozium.desktop.port": String(port) }
			const mounts = { "/configuration": "", "/hub": "hub", "/app/local": "local", "/app/.runtime/local-deps": ".runtime/local-deps",
				"/logs": ".runtime/logs", "/host-scripts": ".runtime/host-socket", "/hub/readonly/safe-scripts": "hub/readonly/safe-scripts" }
			if (Object.entries(expected).some(([key, value_]) => value.labels?.[key] !== value_) ||
				Object.entries(mounts).some(([target, source]) => !value.mounts?.some(mount =>
					mount.Destination === target && mount.Source === path.join(runtime, source) &&
					mount.RW === !["/host-scripts", "/hub/readonly/safe-scripts"].includes(target)))) {
				throw new Error("Container ownership or mounts do not match this desktop installation. No containers were changed.")
			}
			containers.push({ id, running: value.running })
		}
		return containers
	}
	start(): Promise<void> {
		if (this.closing) return Promise.reject(new Error("Robozium is closing."))
		if (this.pending) return this.pending
		if (this.status.state === "ready") return Promise.resolve()
		this.abort = new AbortController()
		this.status = { state: "starting", message: "Checking Docker…" }
		this.pending = this.launch().catch(error => {
			if (!this.closing) this.status = { state: "error", message: error.message }
			throw error
		}).finally(() => { this.pending = undefined })
		return this.pending
	}
	private async launch() {
		const { runtime, port } = this.settings
		for (const directory of ["local/tools", "local/skills", "local/imports", ".runtime/local-deps", ".runtime/logs", ".runtime/host-socket", "hub/readonly/safe-scripts"]) {
			mkdirSync(path.join(runtime, directory), { recursive: true, mode: 0o700 })
		}
		writeFileSync(path.join(runtime, ".runtime/compose.env"), "# Controlled desktop interpolation only.\n", { mode: 0o600 })
		this.docker = (this.options.findDocker ?? findDocker)() ?? ""
		if (!this.docker) throw new Error("Docker was not found. Install Docker with Compose, then retry.")
		if (!this.targetPinned) {
			this.env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(COMPOSE_|ROBOZIUM_)/.test(name)))
			// Keep every command, retry, and cleanup on the original target even after `docker context use`.
			// Explicit host/context settings retain Docker's own precedence and TLS configuration.
			if (!this.env.DOCKER_HOST && !this.env.DOCKER_CONTEXT) {
				try {
					const context = (await this.command(["context", "show"])).trim()
					if (!context) throw new Error("Empty Docker context.")
					this.env.DOCKER_CONTEXT = context
				} catch {
					this.abort.signal.throwIfAborted()
					throw new Error("Could not resolve Docker's context. Check Docker configuration and retry.")
				}
			}
			this.targetPinned = true
		}
		let versionText: string
		try { versionText = await this.command(["compose", "version", "--short"]) }
		catch { throw new Error("Docker Compose is unavailable. Install Compose v2.24 or newer, then retry.") }
		const version = versionText.trim().match(/^v?(\d+)\.(\d+)/)
		if (!version || +version[1] < 2 || (+version[1] === 2 && +version[2] < 24)) throw new Error("Docker Compose v2.24 or newer is required.")
		let security: string
		try { security = await this.command(["info", "--format", "{{json .SecurityOptions}}"]) }
		catch { throw new Error("Docker is unavailable. Start Docker and ensure your account can access it, then retry.") }
		let build: string
		try { build = JSON.parse(readFileSync(path.join(this.options.source, "build-id.json"), "utf8")).id }
		catch { throw new Error("Backend files are missing. Rebuild or reinstall Robozium.") }
		if (!/^[a-f0-9]{64}$/.test(build)) throw new Error("Invalid backend build identifier. Restage the backend files.")
		Object.assign(this.env, {
			ROBOZIUM_DESKTOP_SOURCE: this.options.source, ROBOZIUM_DESKTOP_RUNTIME: runtime,
			ROBOZIUM_DESKTOP_BUILD_ID: build, ROBOZIUM_DESKTOP_INSTALLATION: this.settings.installation,
			ROBOZIUM_DESKTOP_API_PORT: String(port), ROBOZIUM_MODE: this.options.mode,
			ROBOZIUM_API_USER: security.includes("rootless") ? "0:0" : `${process.getuid?.() ?? 10001}:${process.getgid?.() ?? 10001}`,
		})
		const containers = await this.ownedContainers()
		if (!(await (this.options.checkPort ?? portAvailable)(port)) && !containers.some(container => container.running)) {
			throw new Error(`API port ${port} is already in use. Close the other application or choose a different desktop API port.`)
		}
		this.verified = true
		let cached = false
		try { cached = (await this.command(["image", "inspect", "--format", '{{index .Config.Labels "fi.tachion.robozium.desktop.build"}}', `${this.settings.project}-api`])).trim() === build }
		catch { this.abort.signal.throwIfAborted() }
		const log = (text: string) => appendFileSync(path.join(runtime, ".runtime/logs/docker.log"), text, { mode: 0o600 })
		if (!cached) {
			this.status = { state: "starting", message: "Building the backend. The first launch requires internet and can take several minutes…" }
			await this.compose(["build", "api"], { timeout: 1800_000, log })
		}
		this.status = { state: "starting", message: "Starting the backend…" }
		await this.compose(["up", "--detach", "--no-build", "api"], { timeout: 120_000, log })
		await this.ownedContainers()
		const deadline = Date.now() + (this.options.readinessTimeout ?? 180_000)
		while (Date.now() < deadline) {
			this.abort.signal.throwIfAborted()
			try {
				const response = await (this.options.fetch ?? fetch)(`http://127.0.0.1:${port}/ready`, {
					signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(2500)]),
				})
				if (response.ok && (await response.json()).status === "ready") {
					this.abort.signal.throwIfAborted()
					this.status = { state: "ready", message: "Backend ready" }
					return
				}
			} catch { this.abort.signal.throwIfAborted() }
			await delay(this.options.pollInterval ?? 500, undefined, { signal: this.abort.signal })
		}
		throw new Error("Backend readiness timed out. Check the desktop Docker log and retry; your data is preserved.")
	}
	close(): Promise<void> {
		if (this.shutdown) return this.shutdown
		this.closing = true
		this.abort.abort()
		this.shutdown = (async () => {
			await this.pending?.catch(() => {})
			if (!this.verified) return
			// Shutdown has its own deadline; startup's signal is already cancelled.
			const cleanup = { signal: AbortSignal.timeout(45_000), timeout: 45_000 }
			const containers = await this.ownedContainers(cleanup)
			if (containers.length) await this.command(["stop", "--time", "30", ...containers.map(container => container.id)], cleanup)
		})()
		return this.shutdown
	}
}
