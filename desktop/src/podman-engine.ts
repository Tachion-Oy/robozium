import { rmSync, writeFileSync } from "node:fs"
import type { BackendContainer, ContainerEngine, ContainerInspection, EngineCall, ImageBuild } from "./container-engine.ts"
import { findExecutable, runCommand } from "./host-command.ts"

interface PodmanOptions {
	run?: typeof runCommand
	findPodman?: () => string | undefined
}

/**
 * Subordinate IDs required beyond the user's own: the range the fix below
 * grants, and the default for new Ubuntu and Debian users. It covers any UID
 * the image's own user has below it, so the image's UID needs no second home.
 */
const SUBORDINATE_IDS = 65536

interface PodmanInfo {
	host?: {
		security?: { rootless?: boolean }
		idMappings?: { uidmap?: { size?: number }[] | null; gidmap?: { size?: number }[] | null } | null
	}
}

/**
 * Rootless Podman on Linux: containers run as the user who starts the app, with
 * no daemon and no privileged group. The container shares the user's network,
 * so the API's 127.0.0.1 listener is the host's loopback. Container root is the
 * user's own account, so files in the hub stay theirs.
 */
export class PodmanEngine implements ContainerEngine {
	readonly name = "Podman"
	private executable = ""
	private readonly execute: typeof runCommand
	private readonly findPodman: () => string | undefined
	/**
	 * The user's environment once, for every call: always this machine's own
	 * rootless Podman, never a remote connection or another tool's settings.
	 * Electron sets the session bus to `disabled:` when there is none; Podman would
	 * then ask that bus for the user's systemd and fail instead of managing without.
	 */
	private readonly environment = Object.fromEntries(
		Object.entries(process.env).filter(([name, value]) => !/^(ROBOZIUM_|ROBOZ_|CONTAINER_HOST$|CONTAINER_CONNECTION$)/.test(name)
			&& !(name === "DBUS_SESSION_BUS_ADDRESS" && value === "disabled:")),
	)

	constructor(options: PodmanOptions = {}) {
		this.execute = options.run ?? runCommand
		this.findPodman = options.findPodman ?? (() => findExecutable("podman"))
	}

	async prepare(call: EngineCall): Promise<void> {
		this.executable = this.findPodman() ?? ""
		if (!this.executable) {
			throw new Error('Podman was not found. Install it with "sudo apt install podman", then retry.')
		}
		let info: PodmanInfo
		try {
			info = JSON.parse(await this.command(["info", "--format", "json"], call))
		} catch (error) {
			call.signal.throwIfAborted()
			throw new Error('Podman is unavailable. Run "podman info" in a terminal to see why, then retry.', { cause: error })
		}
		if (info.host?.security?.rootless !== true) {
			throw new Error("Podman runs as root here. Start Robozium as your own user, not as root.")
		}
		// Beyond the user's own ID, the image's own user needs its UID and GID mapped to unpack.
		const mapped = (ranges?: { size?: number }[] | null) => (ranges ?? []).reduce((total, range) => total + (range.size ?? 0), 0)
		if (Math.min(mapped(info.host.idMappings?.uidmap), mapped(info.host.idMappings?.gidmap)) <= SUBORDINATE_IDS) {
			const range = `100000-${100000 + SUBORDINATE_IDS - 1}`
			throw new Error(
				"Podman has too few subordinate user and group IDs for your account. Run " +
				`"sudo usermod --add-subuids ${range} --add-subgids ${range} $USER" and "podman system migrate", then retry.`,
			)
		}
	}

	async imageLabel(image: string, label: string, call: EngineCall): Promise<string | undefined> {
		try {
			const value = await this.command(["image", "inspect", "--format", `{{index .Config.Labels "${label}"}}`, localImage(image)], call)
			return value.trim()
		} catch {
			call.signal.throwIfAborted()
			return undefined
		}
	}

	async build(build: ImageBuild, call: EngineCall): Promise<void> {
		await this.command([
			"build", "--target", build.target, "--tag", localImage(build.image),
			...Object.entries(build.buildArguments).flatMap(([name, value]) => ["--build-arg", `${name}=${value}`]),
			build.context,
		], call)
	}

	async list(label: string, value: string, call: EngineCall): Promise<string[]> {
		const output = (await this.command(["ps", "--all", "--quiet", "--no-trunc", "--filter", `label=${label}=${value}`], call)).trim()
		const ids = output ? output.split(/\s+/) : []
		if (ids.some(id => !/^[a-f0-9]{12,64}$/.test(id))) throw new Error("Invalid container identity.")
		return ids
	}

	async inspect(id: string, call: EngineCall): Promise<ContainerInspection> {
		const format = '{"labels":{{json .Config.Labels}},"mounts":{{json .Mounts}},"running":{{.State.Running}}}'
		const inspection: { labels: Record<string, string> | null; mounts: { Source: string; Destination: string; RW: boolean }[] | null; running: boolean } =
			JSON.parse(await this.command(["container", "inspect", "--format", format, id], call))
		return {
			labels: inspection.labels ?? {},
			running: inspection.running,
			mounts: (inspection.mounts ?? []).map(mount => ({ source: mount.Source, destination: mount.Destination, writable: mount.RW })),
		}
	}

	async run(container: BackendContainer, call: EngineCall): Promise<void> {
		const volumes = container.mounts.flatMap(mount => {
			// `--volume` separates its fields with colons; a path holding one cannot be mounted exactly.
			if (mount.source.includes(":") || mount.destination.includes(":")) {
				throw new Error(`Podman cannot mount ${mount.source}, because its path contains a colon. Choose another hub folder.`)
			}
			return ["--volume", `${mount.source}:${mount.destination}${mount.writable ? "" : ":ro"}`]
		})
		// Values go through a file only this user can read, so no other process can read them from the command line.
		const environment = Object.entries(container.environment).map(([name, value]) => `${name}=${value}\n`).join("")
		rmSync(container.environmentFile, { force: true })
		writeFileSync(container.environmentFile, environment, { mode: 0o600, flag: "wx" })
		try {
			await this.command([
				"run", "--detach", "--pull", "never", "--name", container.name,
				...Object.entries(container.labels).flatMap(([name, value]) => ["--label", `${name}=${value}`]),
				"--network", "host",
				"--init",
				"--user", "0:0",
				"--cap-drop", "all",
				"--security-opt", "no-new-privileges",
				"--stop-timeout", String(container.stopTimeoutSeconds),
				"--env-file", container.environmentFile,
				...volumes,
				localImage(container.image),
				...container.command.map(part => part.replace("{address}", "127.0.0.1")),
			], call)
		} finally {
			rmSync(container.environmentFile, { force: true })
		}
	}

	async restart(id: string, timeoutSeconds: number, call: EngineCall): Promise<void> {
		await this.command(["restart", "--time", String(timeoutSeconds), id], call)
	}

	async stop(ids: string[], timeoutSeconds: number, call: EngineCall): Promise<void> {
		await this.command(["stop", "--time", String(timeoutSeconds), ...ids], call)
	}

	async remove(ids: string[], call: EngineCall): Promise<void> {
		await this.command(["rm", ...ids], call)
	}

	logs(id: string, lines: number, call: EngineCall): Promise<string> {
		return this.command(["logs", "--tail", String(lines), id], call)
	}

	private command(args: string[], call: EngineCall): Promise<string> {
		return this.execute(this.executable, args, { cwd: "/", env: this.environment, ...call })
	}
}

/** Images this engine builds stay local; the full name keeps Podman from searching registries for them. */
function localImage(image: string): string {
	return `localhost/${image}`
}
