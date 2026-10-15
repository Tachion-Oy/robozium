import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import path from "node:path"

export function backendProfile(directory: string, mode: "live" | "mock", portOverride?: string) {
	mkdirSync(directory, { recursive: true, mode: 0o700 })
	const profile = realpathSync(directory)
	const settingsFile = path.join(profile, "settings.json")
	const settings = existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, "utf8")) : undefined
	if (settings !== undefined && !/^[a-f0-9]{12}$/.test(settings?.installationId ?? "")) {
		throw new Error("Invalid desktop installation identifier in settings.json.")
	}
	const identityFile = path.join(profile, "backend-installation-id")
	const saved = existsSync(identityFile) ? readFileSync(identityFile, "utf8").trim() : undefined
	const installation = settings?.installationId ?? saved ?? randomBytes(6).toString("hex")
	if (!/^[a-f0-9]{12}$/.test(installation) || (saved && saved !== installation)) {
		throw new Error("Desktop backend ownership does not match its saved installation identifier.")
	}
	const port = Number(portOverride ?? settings?.ports?.[mode]?.api ?? (mode === "live" ? 18001 : 18000))
	if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Choose an API port between 1024 and 65535.")
	if (!saved) writeFileSync(identityFile, installation + "\n", { flag: "wx", mode: 0o600 })
	return { installation, port, runtime: path.join(profile, mode), project: `robozium-desktop-${installation}-${mode}` }
}
