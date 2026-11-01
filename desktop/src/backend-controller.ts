import { appendFileSync, readFileSync } from "node:fs"
import net from "node:net"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import type { BackendStatus, HostServiceStatus } from "./bridge.d.ts"
import { loadOrCreateBackendProfile } from "./backend-profile.ts"
import { BuildProgress } from "./build-progress.ts"
import { backendBuildTarget, backendCommand, backendEnvironment, backendStopTimeoutSeconds, isInside, prepareBackendRuntime, resolveBackendLayout, type BackendLayout } from "./backend-layout.ts"
import type { BackendContainer, ContainerEngine, ContainerInspection, EngineCall } from "./container-engine.ts"
import { HostServices } from "./host-services.ts"
import { HubFolderError, resolveHubFolder } from "./hub-folder.ts"
import type { HubFolderLocation } from "./locations.ts"

interface BackendOptions {
	profile: string
	source: string
	/** The user's hub folder; without one, the runtime keeps a throwaway hub. */
	hubFolder?: HubFolderLocation | null
	mode: "live" | "mock"
	port?: string
	/** The container engine for this platform, as `platformEngine` chooses it. */
	engine: ContainerEngine
	fetch?: typeof fetch
	checkPort?: typeof portAvailable
	hostServices?: HostServices
	readinessTimeout?: number
	pollInterval?: number
}

// Where a startup that builds the image sits on the progress bar. The build fills it up
// to `built`; the renderer fills the rest as the screen fades on ready.
const STARTUP_PROGRESS = { built: 0.9, hostServices: 0.93, backend: 0.96 }

const LABELS = {
	project: "fi.tachion.robozium.desktop.project",
	installation: "fi.tachion.robozium.desktop.installation",
	port: "fi.tachion.robozium.desktop.port",
	/** The staged backend's build identifier, on both the image and the container. */
	build: "fi.tachion.robozium.desktop.build",
}

interface OwnedContainer {
	id: string
	running: boolean
	/** Built from the current image with the current mounts, so it can be kept as it is. */
	current: boolean
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
	private status: BackendStatus = { state: "starting", message: "Checking the container engine…" }
	/** Startup, restart or recreate; only one runs at a time and shutdown waits for it. */
	private pendingStartup?: Promise<void>
	private pendingShutdown?: Promise<void>
	private startupAbort = new AbortController()
	private closing = false
	private ownershipVerified = false
	private readonly settings: ReturnType<typeof loadOrCreateBackendProfile>
	/** Resolved at each launch, so a newly chosen hub folder applies on retry or restart. */
	private launchedLayout?: BackendLayout
	/** The staged backend's build identifier, read at each launch. */
	private buildId = ""
	private readonly engine: ContainerEngine
	private readonly hostServices: HostServices
	private readonly options: BackendOptions

	constructor(options: BackendOptions) {
		this.options = options
		this.settings = loadOrCreateBackendProfile(options.profile, options.mode, options.port)
		this.engine = options.engine
		this.hostServices = options.hostServices ?? new HostServices()
	}

	snapshot(): BackendStatus {
		return { ...this.status }
	}

	hostServiceStatus(): HostServiceStatus[] {
		return this.hostServices.status()
	}

	/** The host directory mounted as the backend's hub, where agents' files live. */
	get hubDirectory(): string {
		return this.layout.hub
	}

	private get layout(): BackendLayout {
		if (!this.launchedLayout) throw new Error("The backend has not been launched.")
		return this.launchedLayout
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
		this.status = { state: "starting", message: `Checking ${this.engine.name}…` }
		this.pendingStartup = this.withStatus(() => this.launch())

		return this.pendingStartup
	}

	/** Restart the API container; it keeps the environment it was created with. */
	restart(): Promise<void> {
		return this.manage("Restarting the backend…", async containers => {
			if (containers.length !== 1) throw new Error("The backend container is missing. Restart the app.")
			await this.engine.restart(containers[0].id, backendStopTimeoutSeconds, this.call({ timeout: 120_000, log: this.log }))
		})
	}

	/** Recreate the API container from the same image, so it reads `.env` again. Mounted data is kept. */
	recreate(): Promise<void> {
		return this.manage("Recreating the backend…", async containers => {
			await this.removeContainers(containers)
			await this.runContainer()
		})
	}

	private manage(message: string, operation: (containers: OwnedContainer[]) => Promise<void>): Promise<void> {
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
			// Throws before any change when a container is not this installation's.
			await operation(await this.ownedContainers())
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
				this.status = error instanceof HubFolderError ? { state: "error", message, action: "choose-hub-folder" } : { state: "error", message }
			}
			throw error
		} finally {
			this.pendingStartup = undefined
		}
	}

	private async launch(): Promise<void> {
		const { runtime } = this.settings
		const hub = this.options.hubFolder ? resolveHubFolder(this.options.hubFolder, path.dirname(runtime)) : undefined
		this.launchedLayout = resolveBackendLayout(runtime, hub)
		prepareBackendRuntime(this.layout)
		await this.engine.prepare(this.call())
		this.buildId = this.readBuildId()

		await this.verifyRuntimeOwnership()
		const built = await this.ensureImage()

		// Started first, so the backend's first dependency check finds them.
		this.status = { state: "starting", message: "Starting host services…", ...built && { progress: STARTUP_PROGRESS.hostServices } }
		await this.hostServices.start(this.layout, this.options.mode, this.options.source, this.startupAbort.signal)
		this.status = { state: "starting", message: "Starting the backend…", ...built && { progress: STARTUP_PROGRESS.backend } }
		const containers = await this.ownedContainers()
		// A running container from this image and these mounts is kept, such as one a crash left behind.
		if (!(containers.length === 1 && containers[0].running && containers[0].current)) {
			await this.removeContainers(containers)
			await this.runContainer()
		}
		await this.ownedContainers()
		await this.waitUntilReady()
	}

	/** Create and start this installation's API container from the current image and layout. */
	private async runContainer(): Promise<void> {
		const { project, installation, port } = this.settings
		const container: BackendContainer = {
			name: `${project}-api`,
			image: `${project}-api`,
			labels: { [LABELS.project]: project, [LABELS.installation]: installation, [LABELS.port]: String(port), [LABELS.build]: this.buildId },
			mounts: this.layout.mounts,
			environment: backendEnvironment(this.options.mode, port),
			environmentFile: this.layout.containerEnvironment,
			command: backendCommand(this.options.mode, port),
			port,
			stopTimeoutSeconds: backendStopTimeoutSeconds,
		}
		await this.engine.run(container, this.call({ timeout: 120_000, log: this.log }))
	}

	/** Stop and remove containers whose ownership was verified. */
	private async removeContainers(containers: OwnedContainer[]): Promise<void> {
		if (containers.length === 0) return
		const running = containers.filter(container => container.running).map(container => container.id)
		if (running.length > 0) await this.engine.stop(running, backendStopTimeoutSeconds, this.call({ timeout: 60_000 }))
		await this.engine.remove(containers.map(container => container.id), this.call())
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

	private async ownedContainers(overrides: Partial<EngineCall> = {}): Promise<OwnedContainer[]> {
		const ids = await this.engine.list(LABELS.project, this.settings.project, this.call(overrides))
		const containers: OwnedContainer[] = []

		for (const id of ids) {
			const container = await this.engine.inspect(id, this.call(overrides))
			containers.push({ id, running: container.running, current: this.validateOwnership(container) })
		}
		return containers
	}

	/** Throws unless the container is this installation's; reports whether it matches the current build and mounts. */
	private validateOwnership(container: ContainerInspection): boolean {
		const { project, installation, port } = this.settings
		const expectedLabels = {
			[LABELS.project]: project,
			[LABELS.installation]: installation,
			[LABELS.port]: String(port),
		}
		const labelsMatch = Object.entries(expectedLabels).every(([label, expected]) => {
			return container.labels?.[label] === expected
		})
		// The hub mounts may come from any hub folder this installation used before, such as
		// a container left running by a crash after a new folder was chosen. The labels prove
		// ownership, and startup recreates the container with the current folder.
		const mountsMatch = this.layout.mounts.every(expected => {
			const anyHubSource = isInside(expected.source, this.layout.hub)
			return container.mounts.some(mount => {
				return mount.destination === expected.destination
					&& (anyHubSource || mount.source === expected.source)
					&& mount.writable === expected.writable
			})
		})

		if (!labelsMatch || !mountsMatch) {
			throw new Error("Container ownership or mounts do not match this desktop installation. No containers were changed.")
		}
		return container.labels[LABELS.build] === this.buildId
			&& this.layout.mounts.every(expected => container.mounts.some(mount => mount.destination === expected.destination && mount.source === expected.source))
	}

	/** Build the backend image unless this build is already cached; reports whether it built. */
	private async ensureImage(): Promise<boolean> {
		const image = `${this.settings.project}-api`
		const cachedBuildId = await this.engine.imageLabel(image, LABELS.build, this.call())
		if (cachedBuildId === this.buildId) {
			return false
		}
		// An image from another build means an update; none at all means a first launch.
		const updating = cachedBuildId !== undefined

		let dockerfile = ""
		try {
			dockerfile = readFileSync(path.join(this.options.source, "Dockerfile"), "utf8")
		} catch {
			// Progress then weighs steps as the build announces them; the build reports a missing file itself.
		}
		const progress = new BuildProgress(dockerfile)
		const building = (fraction: number): BackendStatus => ({
			state: "starting",
			...updating
				? { message: "Updating the backend…", stage: "updating" as const }
				: { message: "Building the backend. The first launch requires internet and can take several minutes…" },
			progress: STARTUP_PROGRESS.built * fraction,
		})
		this.status = building(0)
		await this.engine.build({
			image,
			context: this.options.source,
			target: backendBuildTarget,
			buildArguments: { ROBOZIUM_DESKTOP_BUILD_ID: this.buildId },
		}, this.call({
			timeout: 1800_000,
			log: output => {
				this.log(output)
				// Output flushed after shutdown aborted startup must not overwrite its status.
				if (!this.startupAbort.signal.aborted) this.status = building(progress.push(output))
			},
		}))
		return true
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
			await this.failIfStopped()

			await delay(this.options.pollInterval ?? 500, undefined, { signal: this.startupAbort.signal })
		}
		throw new Error("Backend readiness timed out. Check the desktop container log and retry; your data is preserved.")
	}

	/** A backend that exited during startup will never become ready; report its own error at once. */
	private async failIfStopped(): Promise<void> {
		const containers = await this.ownedContainers()
		if (containers.length === 0 || containers.some(container => container.running)) return
		const output = await this.engine.logs(containers[0].id, 40, this.call())
		const reason = output.split("\n").map(line => line.trim()).reverse()
			.find(line => /^[A-Za-z.]*(Error|Exception)\b/.test(line))
		throw new Error(`The backend stopped during startup${reason ? `: ${reason}` : ". Check the desktop container log"}. Your data is preserved.`)
	}

	private async stopBackend(): Promise<void> {
		try {
			await this.pendingStartup
		} catch {
			// Failed or cancelled startup still needs ownership-checked cleanup.
		}
		try {
			if (!this.ownershipVerified) {
				return
			}

			// Shutdown has its own deadline; startup's signal is already cancelled.
			const cleanup = { signal: AbortSignal.timeout(45_000), timeout: 45_000 }
			const containers = await this.ownedContainers(cleanup)
			if (containers.length > 0) {
				const ids = containers.map(container => container.id)
				await this.engine.stop(ids, backendStopTimeoutSeconds, this.call(cleanup))
			}
		} finally {
			// After the container, so no backend call is cut off mid-script.
			await this.hostServices.stop()
		}
	}

	/** Startup's cancellation unless overridden, as shutdown does with its own deadline. */
	private call(overrides: Partial<EngineCall> = {}): EngineCall {
		return { signal: this.startupAbort.signal, ...overrides }
	}

	private readonly log = (output: string) => {
		appendFileSync(this.layout.containerLog, output, { mode: 0o600 })
	}
}
