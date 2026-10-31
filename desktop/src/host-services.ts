import { spawn, type ChildProcess } from "node:child_process"
import { closeSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { setTimeout as delay } from "node:timers/promises"
import type { HostServiceStatus } from "./bridge.d.ts"
import type { BackendLayout, HostServiceLayout } from "./backend-layout.ts"
import { findExecutable, runCommand } from "./host-command.ts"
import { endpointType } from "./host-endpoints.ts"
import { hostProcessEnvironment, prepareHostEnvironment } from "./host-environment.ts"

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch {
		return false
	}
}

/** Stop a service an earlier launch started but never stopped, as after a crash of the app.
 * The recorded process is stopped only while it still runs this service's executable.
 */
async function stopLeftover(service: HostServiceLayout, timeout: number, signal: AbortSignal): Promise<void> {
	let pid: number
	try {
		pid = Number(readFileSync(service.pidFile, "utf8"))
		// A reused PID runs something else; `ps` reads a process's command line on Linux and macOS alike.
		const command = await runCommand("ps", ["-o", "args=", "-p", String(pid)], { cwd: "/", env: process.env, signal })
		if (!command.includes(service.executable)) pid = 0
	} catch {
		signal.throwIfAborted()
		pid = 0
	}
	if (pid > 0) {
		try {
			process.kill(-pid, "SIGTERM")
		} catch {
			// It exited meanwhile.
		}
		const deadline = Date.now() + timeout
		while (alive(pid) && Date.now() < deadline) await delay(50)
		if (alive(pid)) process.kill(-pid, "SIGKILL")
	}
	rmSync(service.pidFile, { force: true })
}

interface HostServicesOptions {
	platform?: NodeJS.Platform
	findUv?: () => string | undefined
	run?: typeof runCommand
	readyTimeout?: number
	restartDelay?: number
	stopTimeout?: number
}

interface Supervised {
	service: HostServiceLayout
	/** This launch's lifetime; ends when the services stop or start again. */
	signal: AbortSignal
	env: NodeJS.ProcessEnv
	cwd: string
	child?: ChildProcess
	exited?: Promise<void>
	restarts: number
	timer?: NodeJS.Timeout
}

const MAX_RESTARTS = 2

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
	try {
		// Each service leads its own process group, so its descendants stop with it.
		if (child.pid) process.kill(-child.pid, signal)
	} catch {
		// The service already exited.
	}
}

/** Run the layout's host services for this platform and mode beside the backend container.
 * A service's own failure is reported through `status()` and never stops the backend.
 */
export class HostServices {
	private statuses: HostServiceStatus[] = []
	private supervised: Supervised[] = []
	private lifetime = new AbortController()
	private readonly options: HostServicesOptions

	constructor(options: HostServicesOptions = {}) {
		this.options = options
	}

	status(): HostServiceStatus[] {
		return this.statuses.map(status => ({ ...status }))
	}

	/** Replace any services from an earlier launch with this layout's. Throws only when `signal` aborts. */
	async start(layout: BackendLayout, mode: "live" | "mock", source: string, signal: AbortSignal): Promise<void> {
		await this.stop()
		this.lifetime = new AbortController()
		const lifetime = this.lifetime.signal
		const platform = this.options.platform ?? process.platform
		const services = layout.hostServices.filter(service => service.modes.includes(mode))
		const supported = services.filter(service => service.platforms.includes(platform))
		this.statuses = services.map(service => supported.includes(service)
			? { name: service.name, state: "starting", message: "Starting…" }
			: { name: service.name, state: "unsupported", message: "Not available on this operating system." })
		if (supported.length === 0) return

		const fail = (message: string): void => {
			for (const service of supported) this.update(service.name, "failed", message)
		}
		const uv = (this.options.findUv ?? (() => findExecutable("uv")))()
		if (!uv) {
			fail("Host services need uv on this computer. Install uv, then retry.")
			return
		}
		const env = hostProcessEnvironment(layout.hostEnvironment.directory)
		const startup = AbortSignal.any([signal, lifetime])
		try {
			await prepareHostEnvironment({
				uv, source, env, signal: startup, run: this.options.run ?? runCommand,
				directory: layout.hostEnvironment.directory, log: layout.hostEnvironment.log,
			})
		} catch (error) {
			signal.throwIfAborted()
			if (!lifetime.aborted) fail(error instanceof Error ? error.message : String(error))
			return
		}
		for (const service of supported) {
			const entry: Supervised = { service, signal: lifetime, env, cwd: layout.runtime, restarts: 0 }
			this.supervised.push(entry)
			await this.launch(entry, startup)
		}
		signal.throwIfAborted()
	}

	/** Ask every service to quit, forcing those that outlast the stop timeout. */
	async stop(): Promise<void> {
		this.lifetime.abort()
		const entries = this.supervised
		this.supervised = []
		await Promise.all(entries.map(async entry => {
			clearTimeout(entry.timer)
			const { child, exited } = entry
			if (!child || !exited) return
			signalGroup(child, "SIGTERM")
			const force = setTimeout(() => signalGroup(child, "SIGKILL"), this.options.stopTimeout ?? 10_000)
			try {
				await exited
			} finally {
				clearTimeout(force)
			}
		}))
	}

	private update(name: string, state: HostServiceStatus["state"], message: string): void {
		this.statuses = this.statuses.map(status => status.name === name ? { name, state, message } : status)
	}

	private async launch(entry: Supervised, signal: AbortSignal): Promise<void> {
		const { service } = entry
		try {
			const endpoint = endpointType(service.endpoint.type)
			await stopLeftover(service, this.options.stopTimeout ?? 10_000, signal)
			if (!(await endpoint.clear(service.endpoint.address))) {
				throw new Error(`Another program is serving ${service.endpoint.address}. Stop it, then retry.`)
			}
			if (signal.aborted) return
			const output = openSync(service.log, "a", 0o600)
			let child: ChildProcess
			try {
				child = spawn(service.executable, service.arguments, {
					cwd: entry.cwd, env: entry.env, detached: true, stdio: ["ignore", output, output],
				})
			} finally {
				closeSync(output)
			}
			entry.child = child
			if (child.pid) writeFileSync(service.pidFile, String(child.pid), { mode: 0o600 })
			entry.exited = new Promise(resolve => {
				const exited = (): void => {
					rmSync(service.pidFile, { force: true })
					this.exited(entry, child)
					resolve()
				}
				child.once("exit", exited)
				child.once("error", exited)
			})

			const deadline = Date.now() + (this.options.readyTimeout ?? 30_000)
			while (entry.child === child) {
				if (await endpoint.answers(service.endpoint.address)) {
					if (!signal.aborted) this.update(service.name, "running", "Running.")
					return
				}
				if (Date.now() >= deadline) {
					this.update(service.name, "failed", `Did not start answering. See ${service.log}.`)
					entry.restarts = MAX_RESTARTS
					signalGroup(child, "SIGTERM")
					return
				}
				await delay(100, undefined, { signal })
			}
		} catch (error) {
			if (!signal.aborted) this.update(service.name, "failed", error instanceof Error ? error.message : String(error))
		}
	}

	private exited(entry: Supervised, child: ChildProcess): void {
		if (entry.child !== child) return
		entry.child = undefined
		if (entry.signal.aborted) return
		const { service } = entry
		if (entry.restarts >= MAX_RESTARTS) {
			if (this.statuses.find(status => status.name === service.name)?.state !== "failed") {
				this.update(service.name, "failed", `Stopped unexpectedly. See ${service.log}.`)
			}
			return
		}
		entry.restarts += 1
		this.update(service.name, "starting", "Restarting after an unexpected stop…")
		entry.timer = setTimeout(() => void this.launch(entry, entry.signal), this.options.restartDelay ?? 1000)
	}
}
