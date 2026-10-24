import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import definition from "./backend-layout.json" with { type: "json" }

/** The desktop's named locations; this layout file is the only place paths are written out. */
export const locations = definition["x-desktop"].locations

/** Whether `child` is `parent` or lies within it. */
export function isInside(child: string, parent: string): boolean {
	const relative = path.relative(parent, child)
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

/** Resolve the same bind mounts that Compose reads, without touching runtime data.
 * Without a hub folder, the runtime's own throwaway hub is used.
 */
export function resolveBackendLayout(runtime: string, hub = path.join(runtime, locations.isolatedHub)) {
	if (!path.isAbsolute(runtime)) {
		throw new Error("Select an absolute desktop runtime directory.")
	}
	if (!path.isAbsolute(hub)) {
		throw new Error("Select an absolute hub folder.")
	}
	const roots = { ROBOZIUM_DESKTOP_RUNTIME: runtime, ROBOZIUM_DESKTOP_HUB: hub }
	const mounts = definition.services.api.volumes.map(mount => {
		const match = /^\$\{(ROBOZIUM_DESKTOP_RUNTIME|ROBOZIUM_DESKTOP_HUB)(?::\?[^}]*)?\}(\/.*)?$/.exec(mount.source)
		if (!match) {
			throw new Error("Desktop bind sources must use the configured runtime or hub root.")
		}
		return {
			source: path.join(roots[match[1] as keyof typeof roots], match[2] ?? ""),
			destination: mount.target,
			writable: !mount.read_only,
		}
	})

	const mountSource = (destination: string) => {
		const mount = mounts.find(mount => mount.destination === destination)
		if (!mount) {
			throw new Error(`Desktop layout references an unknown mount: ${destination}`)
		}
		return mount.source
	}

	const desktop = definition["x-desktop"]
	const composeEnvironment = path.join(runtime, desktop.composeEnvironment)
	const directories = new Set(mounts.map(mount => mount.source))
	directories.add(path.dirname(composeEnvironment))

	return {
		runtime,
		hub: mountSource("/hub"),
		mounts,
		directories: [...directories],
		composeEnvironment,
		dockerLog: path.join(mountSource(desktop.dockerLog.mount), desktop.dockerLog.filename),
	}
}

/** Prepare bind sources and the desktop's Compose interpolation file.
 * The hub owns application directories and files within those mounts. Only a
 * throwaway hub inside the runtime is created here; a user's hub folder must exist.
 * Shared by Electron and the standalone Node setup command.
 */
export function prepareBackendRuntime(layout: ReturnType<typeof resolveBackendLayout>): void {
	if (!isInside(layout.hub, layout.runtime) && !existsSync(layout.hub)) {
		throw new Error(`Hub folder ${layout.hub} is missing.`)
	}
	for (const directory of layout.directories) {
		mkdirSync(directory, { recursive: true, mode: 0o700 })
	}
	writeFileSync(layout.composeEnvironment, "# Controlled desktop interpolation only.\n", { mode: 0o600 })
}
