import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import { locations } from "./backend-layout.ts"
import type { AppTheme } from "./bridge.d.ts"

/** Native window colour behind the renderer, matching each theme's canvas. */
export const themeBackground: Readonly<Record<AppTheme, string>> = { dark: "#07080a", light: "#f3f0e7" }

/**
 * settings.json holds only these UI preferences. Backend configuration lives in
 * hub.config.py and the runtime's .env; the installation identity in backend-installation-id.
 */
export interface DesktopSettings {
	theme: AppTheme
}

export function isAppTheme(value: unknown): value is AppTheme {
	return value === "dark" || value === "light"
}

function settingsFile(profile: string): string {
	return path.join(profile, locations.settings)
}

/** Each preference falls back on its own; a missing or unreadable file opens with defaults. */
export function readSettings(profile: string): DesktopSettings {
	let saved: Record<string, unknown> = {}
	try {
		const value: unknown = JSON.parse(readFileSync(settingsFile(profile), "utf8"))
		if (typeof value === "object" && value !== null && !Array.isArray(value)) saved = value as Record<string, unknown>
	} catch {
		// Defaults apply; saving later refuses to replace the unreadable file.
	}
	return {
		theme: isAppTheme(saved.theme) ? saved.theme : "dark",
	}
}

/**
 * Save preferences into settings.json. Unknown keys are kept, so a file written
 * by a newer or older version keeps what it does not understand.
 */
export function saveSettings(profile: string, changes: Partial<DesktopSettings>): void {
	const file = settingsFile(profile)
	// An unreadable file throws rather than being replaced, so a hand edit is not lost.
	const settings: unknown = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}
	if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
		throw new Error("settings.json does not contain an object.")
	}
	writeFileSync(`${file}.tmp`, `${JSON.stringify({ ...settings, ...changes }, null, 2)}\n`, { mode: 0o600 })
	renameSync(`${file}.tmp`, file)
}
