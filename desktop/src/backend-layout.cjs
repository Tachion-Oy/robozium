const { mkdirSync, writeFileSync } = require("node:fs")
const path = require("node:path")
const definition = require("./backend-layout.json")

/** Resolve the same bind mounts that Compose reads, without touching runtime data.
 * @param {string} runtime
 */
function resolveBackendLayout(runtime) {
	if (!path.isAbsolute(runtime)) {
		throw new Error("Select an absolute desktop runtime directory.")
	}
	const rootVariable = "${ROBOZIUM_DESKTOP_RUNTIME}"
	const mounts = definition.services.api.volumes.map(mount => {
		if (mount.source !== rootVariable && !mount.source.startsWith(rootVariable + "/")) {
			throw new Error("Desktop bind sources must use the configured runtime root.")
		}
		return {
			source: path.join(runtime, mount.source.slice(rootVariable.length)),
			destination: mount.target,
			writable: !mount.read_only,
		}
	})

	/** @param {string} destination */
	const mountSource = destination => {
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
		mounts,
		directories: [...directories],
		composeEnvironment,
		dockerLog: path.join(mountSource(desktop.dockerLog.mount), desktop.dockerLog.filename),
	}
}

/** Prepare bind sources and the desktop's Compose interpolation file.
 * The hub owns application directories and files within those mounts.
 * Shared by Electron and the standalone Node setup command.
 * @param {ReturnType<typeof resolveBackendLayout>} layout
 */
function prepareBackendRuntime(layout) {
	for (const directory of layout.directories) {
		mkdirSync(directory, { recursive: true, mode: 0o700 })
	}
	writeFileSync(layout.composeEnvironment, "# Controlled desktop interpolation only.\n", { mode: 0o600 })
}

module.exports = { resolveBackendLayout, prepareBackendRuntime }
