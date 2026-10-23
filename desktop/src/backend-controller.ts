import { appendFileSync, readFileSync } from "node:fs"
import net from "node:net"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import type { BackendStatus } from "./bridge"
import { loadOrCreateBackendProfile } from "./backend-profile"
import { prepareBackendRuntime, resolveBackendLayout } from "./backend-layout.cjs"
import { findDocker, runCommand, type CommandOptions } from "./docker-command"

interface BackendOptions {
	profile: string
	source: string
	compose: string
	mode: "live" | "mock"
	port?: string
	run?: typeof runCommand
	findDocker?: typeof findDocker
	fetch?: typeof fetch
	checkPort?: typeof portAvailable
	readinessTimeout?: number
	pollInterval?: number
}

interface ContainerInspection {
	labels: Record<string, string>
	running: boolean
	mounts: {
		Source: string
		Destination: string
		RW: boolean
	}[]
}

interface OwnedContainer {
	id: string
	running: boolean
}

export function portAvailable(port: number): Promise<boolean> {
	return new Promise((resolve, reject) => {
		const server = net.createServer()
		server.once("error", (error: NodeJS.ErrnoException) => {
			if (error.code === "EADDRINUSE") {
				resolve(false)
			} else {
				reject(error)
			}
		})
		server.listen(port, "127.0.0.1", () => {
			server.close(() => resolve(true))
		})
	})
}

/** API-only adaptation of the ownership and cancellation boundaries in experiment 076b2c9. */
export class BackendController {
	private status: BackendStatus = { state: "starting", message: "Checking Docker…" }
	/** Startup, restart or recreate; only one runs at a time and shutdown waits for it. */
	private pendingStartup?: Promise<void>
	private pendingShutdown?: Promise<void>
	private startupAbort = new AbortController()
	private closing = false
	private ownershipVerified = false
	private dockerExecutable = ""
	private environment: NodeJS.ProcessEnv = {}
	private targetPinned = false
	private readonly settings: ReturnType<typeof loadOrCreateBackendProfile>
	private readonly layout: ReturnType<typeof resolveBackendLayout>
	private readonly run: typeof runCommand

	constructor(private readonly options: BackendOptions) {
		this.settings = loadOrCreateBackendProfile(options.profile, options.mode, options.port)
		this.layout = resolveBackendLayout(this.settings.runtime)
		this.run = options.run ?? runCommand
	}

	snapshot(): BackendStatus {
		return { ...this.status }
	}

	/** The host directory mounted as the backend's hub, where agents' files live. */
	get hubDirectory(): string {
		const hub = this.layout.mounts.find(mount => mount.destination === "/hub")
		if (!hub) throw new Error("The desktop layout has no hub mount.")
		return hub.source
	}

	connection(): { baseUrl: string } {
		return { baseUrl: `http://127.0.0.1:${this.settings.port}` }
	}

	start(): Promise<void> {
		if (this.closing) {
			return Promise.reject(new Error("Robozium is closing."))
		}
		if (this.pendingStartup) {
			return this.pendingStartup
		}
		if (this.status.state === "ready") {
			return Promise.resolve()
		}

		this.startupAbort = new AbortController()
		this.status = { state: "starting", message: "Checking Docker…" }
		this.pendingStartup = this.withStatus(() => this.launch())

		return this.pendingStartup
	}

	/** Restart the API container; it keeps the environment it was created with. */
	restart(): Promise<void> {
		return this.manage("Restarting the backend…", ["restart", "api"])
	}

	/** Recreate the API container from the same image, so it reads `.env` again. Mounted data is kept. */
	recreate(): Promise<void> {
		return this.manage("Recreating the backend…", ["up", "--detach", "--no-build", "--force-recreate", "--no-deps", "api"])
	}

	private manage(message: string, args: string[]): Promise<void> {
		if (this.closing) {
			return Promise.reject(new Error("Robozium is closing."))
		}
		if (this.pendingStartup) {
			return Promise.reject(new Error("A backend operation is already running."))
		}
		if (this.status.state !== "ready") {
			return Promise.reject(new Error("Start the backend before managing it."))
		}
		this.status = { state: "starting", message }
		this.pendingStartup = this.withStatus(async () => {
			const log = (output: string) => {
				appendFileSync(this.layout.dockerLog, output, { mode: 0o600 })
			}
			// Throws before any change when a container is not this installation's.
			await this.ownedContainers()
			await this.compose(args, { timeout: 120_000, log })
			await this.waitUntilReady()
		})
		return this.pendingStartup
	}

	close(): Promise<void> {
		if (this.pendingShutdown) {
			return this.pendingShutdown
		}

		this.closing = true
		this.startupAbort.abort()
		this.pendingShutdown = this.stopBackend()
		return this.pendingShutdown
	}

	private async withStatus(operation: () => Promise<void>): Promise<void> {
		try {
			await operation()
		} catch (error) {
			if (!this.closing) {
				const message = error instanceof Error ? error.message : String(error)
				this.status = { state: "error", message }
			}
			throw error
		} finally {
			this.pendingStartup = undefined
		}
	}

	private async launch(): Promise<void> {
		prepareBackendRuntime(this.layout)
		const securityOptions = await this.prepareDocker()
		const buildId = this.readBuildId()
		const { runtime, port, installation } = this.settings

		Object.assign(this.environment, {
			ROBOZIUM_DESKTOP_SOURCE: this.options.source,
			ROBOZIUM_DESKTOP_RUNTIME: runtime,
			ROBOZIUM_DESKTOP_BUILD_ID: buildId,
			ROBOZIUM_DESKTOP_INSTALLATION: installation,
			ROBOZIUM_DESKTOP_API_PORT: String(port),
			ROBOZIUM_MODE: this.options.mode,
			ROBOZIUM_API_USER: securityOptions.includes("rootless")
				? "0:0"
				: `${process.getuid?.() ?? 10001}:${process.getgid?.() ?? 10001}`,
		})

		await this.verifyRuntimeOwnership()

		const log = (output: string) => {
			appendFileSync(this.layout.dockerLog, output, { mode: 0o600 })
		}
		await this.ensureImage(buildId, log)

		this.status = { state: "starting", message: "Starting the backend…" }
		await this.compose(["up", "--detach", "--no-build", "api"], { timeout: 120_000, log })
		await this.ownedContainers()
		await this.waitUntilReady()
	}

	private async prepareDocker(): Promise<string> {
		this.dockerExecutable = (this.options.findDocker ?? findDocker)() ?? ""
		if (!this.dockerExecutable) {
			throw new Error("Docker was not found. Install Docker with Compose, then retry.")
		}
		await this.pinDockerTarget()

		let versionText: string
		try {
			versionText = await this.command(["compose", "version", "--short"])
		} catch {
			throw new Error("Docker Compose is unavailable. Install Compose v2.24 or newer, then retry.")
		}

		const version = versionText.trim().match(/^v?(\d+)\.(\d+)/)
		const major = Number(version?.[1] ?? 0)
		const minor = Number(version?.[2] ?? 0)
		if (major < 2 || (major === 2 && minor < 24)) {
			throw new Error("Docker Compose v2.24 or newer is required.")
		}

		try {
			return await this.command(["info", "--format", "{{json .SecurityOptions}}"])
		} catch {
			throw new Error("Docker is unavailable. Start Docker and ensure your account can access it, then retry.")
		}
	}

	private async pinDockerTarget(): Promise<void> {
		if (this.targetPinned) {
			return
		}

		this.environment = Object.fromEntries(
			Object.entries(process.env).filter(([name]) => !/^(COMPOSE_|ROBOZIUM_)/.test(name)),
		)

		// Explicit host/context settings retain Docker's own precedence and TLS configuration.
		if (!this.environment.DOCKER_HOST && !this.environment.DOCKER_CONTEXT) {
			try {
				const context = (await this.command(["context", "show"])).trim()
				if (!context) {
					throw new Error("Empty Docker context.")
				}
				this.environment.DOCKER_CONTEXT = context
			} catch {
				this.startupAbort.signal.throwIfAborted()
				throw new Error("Could not resolve Docker's context. Check Docker configuration and retry.")
			}
		}

		// Reuse this environment for retries and shutdown, even after `docker context use`.
		this.targetPinned = true
	}

	private readBuildId(): string {
		let buildId: string
		try {
			const manifestPath = path.join(this.options.source, "build-id.json")
			buildId = JSON.parse(readFileSync(manifestPath, "utf8")).id
		} catch {
			throw new Error("Backend files are missing. Rebuild or reinstall Robozium.")
		}

		if (!/^[a-f0-9]{64}$/.test(buildId)) {
			throw new Error("Invalid backend build identifier. Restage the backend files.")
		}
		return buildId
	}

	private async verifyRuntimeOwnership(): Promise<void> {
		const containers = await this.ownedContainers()
		const portIsAvailable = await (this.options.checkPort ?? portAvailable)(this.settings.port)
		const ownedBackendIsRunning = containers.some(container => container.running)

		if (!portIsAvailable && !ownedBackendIsRunning) {
			throw new Error(
				`API port ${this.settings.port} is already in use. ` +
				"Close the other application or choose a different desktop API port.",
			)
		}
		this.ownershipVerified = true
	}

	private async ownedContainers(overrides: Partial<CommandOptions> = {}): Promise<OwnedContainer[]> {
		const output = await this.command([
			"ps", "--all", "--quiet",
			"--filter", `label=com.docker.compose.project=${this.settings.project}`,
		], overrides)
		const ids = output.trim() ? output.trim().split(/\s+/) : []
		const containers: OwnedContainer[] = []

		for (const id of ids) {
			if (!/^[a-f0-9]{12,64}$/.test(id)) {
				throw new Error("Invalid Docker container identity.")
			}

			const inspectionFormat = '{"labels":{{json .Config.Labels}},"mounts":{{json .Mounts}},"running":{{.State.Running}}}'
			const inspection = await this.command(["inspect", "--format", inspectionFormat, id], overrides)
			const container: ContainerInspection = JSON.parse(inspection)
			this.validateOwnership(container)
			containers.push({ id, running: container.running })
		}
		return containers
	}

	private validateOwnership(container: ContainerInspection): void {
		const { project, installation, port } = this.settings
		const expectedLabels = {
			"com.docker.compose.project": project,
			"com.docker.compose.service": "api",
			"fi.tachion.robozium.desktop.installation": installation,
			"fi.tachion.robozium.desktop.port": String(port),
		}
		const labelsMatch = Object.entries(expectedLabels).every(([label, expected]) => {
			return container.labels?.[label] === expected
		})
		const mountsMatch = this.layout.mounts.every(expected => {
			return container.mounts?.some(mount => {
				return mount.Destination === expected.destination
					&& mount.Source === expected.source
					&& mount.RW === expected.writable
			})
		})

		if (!labelsMatch || !mountsMatch) {
			throw new Error("Container ownership or mounts do not match this desktop installation. No containers were changed.")
		}
	}

	private async ensureImage(buildId: string, log: (output: string) => void): Promise<void> {
		let cached = false
		try {
			const cachedBuildId = await this.command([
				"image", "inspect", "--format",
				'{{index .Config.Labels "fi.tachion.robozium.desktop.build"}}',
				`${this.settings.project}-api`,
			])
			cached = cachedBuildId.trim() === buildId
		} catch {
			this.startupAbort.signal.throwIfAborted()
		}

		if (!cached) {
			this.status = {
				state: "starting",
				message: "Building the backend. The first launch requires internet and can take several minutes…",
			}
			await this.compose(["build", "api"], { timeout: 1800_000, log })
		}
	}

	private async waitUntilReady(): Promise<void> {
		const deadline = Date.now() + (this.options.readinessTimeout ?? 180_000)
		const url = `${this.connection().baseUrl}/ready`

		while (Date.now() < deadline) {
			this.startupAbort.signal.throwIfAborted()
			try {
				const response = await (this.options.fetch ?? fetch)(url, {
					// Node fetch sends Fetch Metadata too; identify this desktop health request.
					headers: { Origin: "robozium://app" },
					signal: AbortSignal.any([this.startupAbort.signal, AbortSignal.timeout(2500)]),
				})
				if (response.ok && (await response.json()).status === "ready") {
					this.startupAbort.signal.throwIfAborted()
					this.status = { state: "ready", message: "Backend ready" }
					return
				}
			} catch {
				this.startupAbort.signal.throwIfAborted()
			}

			await delay(this.options.pollInterval ?? 500, undefined, { signal: this.startupAbort.signal })
		}
		throw new Error("Backend readiness timed out. Check the desktop Docker log and retry; your data is preserved.")
	}

	private async stopBackend(): Promise<void> {
		try {
			await this.pendingStartup
		} catch {
			// Failed or cancelled startup still needs ownership-checked cleanup.
		}
		if (!this.ownershipVerified) {
			return
		}

		// Shutdown has its own deadline; startup's signal is already cancelled.
		const cleanup = { signal: AbortSignal.timeout(45_000), timeout: 45_000 }
		const containers = await this.ownedContainers(cleanup)
		if (containers.length > 0) {
			const ids = containers.map(container => container.id)
			await this.command(["stop", "--time", "30", ...ids], cleanup)
		}
	}

	private command(args: string[], overrides: Partial<CommandOptions> = {}): Promise<string> {
		return this.run(this.dockerExecutable, args, {
			cwd: this.settings.runtime,
			env: this.environment,
			signal: this.startupAbort.signal,
			...overrides,
		})
	}

	private compose(args: string[], overrides: Partial<CommandOptions> = {}): Promise<string> {
		return this.command([
			"compose",
			"--project-name", this.settings.project,
			"--env-file", this.layout.composeEnvironment,
			"--file", this.options.compose,
			...args,
		], overrides)
	}
}
