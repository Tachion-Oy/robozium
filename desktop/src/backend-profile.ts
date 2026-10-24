import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import path from "node:path"
import { locations } from "./backend-layout.ts"

interface BackendProfile {
	installation: string
	port: number
	runtime: string
	project: string
}

/**
 * The installation identity names this installation's Docker backend in both
 * modes; backend-installation-id is its only home. The profile's settings.json
 * holds UI preferences and is never read here.
 */
export function loadOrCreateBackendProfile(directory: string, mode: "live" | "mock", portOverride?: string): BackendProfile {
	mkdirSync(directory, { recursive: true, mode: 0o700 })
	const profileDirectory = realpathSync(directory)

	const identityFile = path.join(profileDirectory, locations.installationId)
	const savedInstallation = existsSync(identityFile)
		? readFileSync(identityFile, "utf8").trim()
		: undefined
	const installation = savedInstallation ?? randomBytes(6).toString("hex")
	if (!/^[a-f0-9]{12}$/.test(installation)) {
		throw new Error("Desktop backend ownership does not match its saved installation identifier.")
	}

	const port = Number(portOverride ?? (mode === "live" ? 18001 : 18000))
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
