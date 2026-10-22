import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { AppTheme } from "./bridge"

/** Native window colour behind the renderer, matching each theme's canvas. */
export const themeBackground: Readonly<Record<AppTheme, string>> = { dark: "#07080a", light: "#f3f0e7" }

export function isAppTheme(value: unknown): value is AppTheme {
	return value === "dark" || value === "light"
}

function settingsFile(profile: string): string {
	return path.join(profile, "settings.json")
}

/** The saved theme; a missing or unreadable settings file opens dark. */
export function readTheme(profile: string): AppTheme {
	try {
		const theme: unknown = JSON.parse(readFileSync(settingsFile(profile), "utf8"))?.theme
		return isAppTheme(theme) ? theme : "dark"
	} catch {
		return "dark"
	}
}

/**
 * Save the theme into settings.json, keeping the other keys: the backend
 * profile keeps its installation identity and ports in the same file.
 */
export function saveTheme(profile: string, theme: AppTheme): void {
	const file = settingsFile(profile)
	// An unreadable file throws rather than being replaced, so its identity survives.
	const settings: unknown = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}
	if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
		throw new Error("settings.json does not contain an object.")
	}
	writeFileSync(`${file}.tmp`, `${JSON.stringify({ ...settings, theme }, null, 2)}\n`, { mode: 0o600 })
	renameSync(`${file}.tmp`, file)
}
