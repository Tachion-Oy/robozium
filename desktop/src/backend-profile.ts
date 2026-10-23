import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import path from "node:path"

interface BackendProfile {
	installation: string
	port: number
	runtime: string
	project: string
}

/** Keep a shared installation identity across modes without rewriting legacy settings. */
export function loadOrCreateBackendProfile(directory: string, mode: "live" | "mock", portOverride?: string): BackendProfile {
	mkdirSync(directory, { recursive: true, mode: 0o700 })
	const profileDirectory = realpathSync(directory)

	const settingsFile = path.join(profileDirectory, "settings.json")
	const settings = existsSync(settingsFile)
		? JSON.parse(readFileSync(settingsFile, "utf8"))
		: undefined
	// Saving the theme or window size can create settings.json without an identifier;
	// the saved identifier file then still names the installation.
	if (settings?.installationId !== undefined && !/^[a-f0-9]{12}$/.test(settings.installationId)) {
		throw new Error("Invalid desktop installation identifier in settings.json.")
	}

	const identityFile = path.join(profileDirectory, "backend-installation-id")
	const savedInstallation = existsSync(identityFile)
		? readFileSync(identityFile, "utf8").trim()
		: undefined
	const installation = settings?.installationId ?? savedInstallation ?? randomBytes(6).toString("hex")
	const validInstallation = /^[a-f0-9]{12}$/.test(installation)
	const identityMismatch = savedInstallation && savedInstallation !== installation
	if (!validInstallation || identityMismatch) {
		throw new Error("Desktop backend ownership does not match its saved installation identifier.")
	}

	const defaultPort = mode === "live" ? 18001 : 18000
	const configuredPort = settings?.ports?.[mode]?.api
	const port = Number(portOverride ?? configuredPort ?? defaultPort)
	if (!Number.isInteger(port) || port < 1024 || port > 65535) {
		throw new Error("Choose an API port between 1024 and 65535.")
	}

	if (!savedInstallation) {
		writeFileSync(identityFile, installation + "\n", { flag: "wx", mode: 0o600 })
	}

	return {
		installation,
		port,
		runtime: path.join(profileDirectory, mode),
		project: `robozium-desktop-${installation}-${mode}`,
	}
}
