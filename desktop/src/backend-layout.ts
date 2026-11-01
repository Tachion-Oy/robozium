import { existsSync, mkdirSync } from "node:fs"
import path from "node:path"
import definition from "./backend-layout.json" with { type: "json" }
import { endpointType } from "./host-endpoints.ts"

/** The desktop's named locations; this layout file is the only place paths are written out. */
export const locations = definition.desktop.locations

/** Whether `child` is `parent` or lies within it. */
export function isInside(child: string, parent: string): boolean {
	const relative = path.relative(parent, child)
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

/** A program the desktop runs on the host beside the backend container, resolved for one runtime and hub. */
export interface HostServiceLayout {
	name: string
	platforms: string[]
	modes: string[]
	/** How the backend reaches the service; its endpoint type defines what `address` means. */
	endpoint: { type: string; address: string }
	log: string
	/** Records the running process, so a launch after a crash can stop what the crash left. */
	pidFile: string
	/** Absolute path inside the host environment. */
	executable: string
	arguments: string[]
}

/** One bind mount: the host folder the container shares and where the container sees it. */
export interface BackendMount {
	source: string
	destination: string
	writable: boolean
}

/** Every host path one runtime and hub use, resolved from this layout file. */
export interface BackendLayout {
	runtime: string
	hub: string
	mounts: BackendMount[]
	/** Folders a launch creates before the container binds them. */
	directories: string[]
	/** Build and start diagnostics from the container engine. */
	containerLog: string
	/** A private file an engine may hand the backend's variables over in, while it starts the container. */
	containerEnvironment: string
	/** The Python environment every host service runs from, and the log of building it. */
	hostEnvironment: { directory: string; log: string }
	hostServices: HostServiceLayout[]
}

/** Resolve the backend container's bind mounts and files, without touching runtime data.
 * Without a hub folder, the runtime's own throwaway hub is used.
 */
export function resolveBackendLayout(runtime: string, hub = path.join(runtime, locations.isolatedHub)): BackendLayout {
	if (!path.isAbsolute(runtime)) {
		throw new Error("Select an absolute desktop runtime directory.")
	}
	if (!path.isAbsolute(hub)) {
		throw new Error("Select an absolute hub folder.")
	}
	const roots = { runtime, hub }
	const resolve = (location: { root: string; path: string }): string => {
		if (location.root !== "runtime" && location.root !== "hub") {
			throw new Error("Desktop backend files must lie in the configured runtime or hub folder.")
		}
		const resolved = path.join(roots[location.root], location.path)
		if (!isInside(resolved, roots[location.root])) {
			throw new Error("Desktop backend files must lie in the configured runtime or hub folder.")
		}
		return resolved
	}
	const mounts = definition.backend.mounts.map((mount): BackendMount => ({
		source: resolve(mount),
		destination: mount.target,
		writable: !mount.readOnly,
	}))

	const mountSource = (destination: string): string => {
		const mount = mounts.find(mount => mount.destination === destination)
		if (!mount) {
			throw new Error(`Desktop layout references an unknown mount: ${destination}`)
		}
		return mount.source
	}

	/** The host path behind a container path, through the deepest mount that holds it. */
	const hostPath = (containerPath: string): string => {
		const mount = mounts
			.filter(mount => !path.posix.relative(mount.destination, containerPath).startsWith(".."))
			.sort((left, right) => right.destination.length - left.destination.length)[0]
		if (!mount) {
			throw new Error(`Desktop layout references a path outside every mount: ${containerPath}`)
		}
		return path.join(mount.source, path.posix.relative(mount.destination, containerPath))
	}

	const desktop = definition.desktop
	const containerEnvironment: Record<string, string> = definition.backend.environment
	const hostServices = Object.entries(desktop.hostServices.services).map(([name, service]): HostServiceLayout => {
		let address: string
		try {
			address = endpointType(service.endpoint.type).resolve(service.endpoint, { hostPath, containerEnvironment })
		} catch (error) {
			throw new Error(`Host service ${name}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
		}
		const endpoint = { type: service.endpoint.type, address }
		return {
			name,
			platforms: service.platforms,
			modes: service.modes,
			endpoint,
			log: path.join(mountSource(service.log.mount), service.log.filename),
			pidFile: path.join(runtime, desktop.hostServices.processes, `${name}.pid`),
			executable: path.join(runtime, desktop.hostServices.environment, service.executable),
			arguments: service.arguments.map(argument => {
				if (typeof argument === "string") return argument
				return "hostPath" in argument && argument.hostPath ? hostPath(argument.hostPath) : endpoint.address
			}),
		}
	})
	const directories = new Set(mounts.map(mount => mount.source))
	directories.add(path.dirname(path.join(runtime, desktop.containerEnvironment)))
	directories.add(path.join(runtime, desktop.hostServices.processes))

	return {
		runtime,
		hub: mountSource("/hub"),
		mounts,
		directories: [...directories],
		containerLog: path.join(mountSource(desktop.containerLog.mount), desktop.containerLog.filename),
		containerEnvironment: path.join(runtime, desktop.containerEnvironment),
		hostEnvironment: {
			directory: path.join(runtime, desktop.hostServices.environment),
			log: path.join(mountSource(desktop.hostServices.environmentLog.mount), desktop.hostServices.environmentLog.filename),
		},
		hostServices,
	}
}

/** Prepare bind sources.
 * The hub owns application directories and files within those mounts. Only a
 * throwaway hub inside the runtime is created here; a user's hub folder must exist.
 */
export function prepareBackendRuntime(layout: BackendLayout): void {
	if (!isInside(layout.hub, layout.runtime) && !existsSync(layout.hub)) {
		throw new Error(`Hub folder ${layout.hub} is missing.`)
	}
	for (const directory of layout.directories) {
		mkdirSync(directory, { recursive: true, mode: 0o700 })
	}
}
