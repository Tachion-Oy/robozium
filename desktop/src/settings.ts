import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { AppTheme } from "./bridge"
import { MAX_ZOOM, MIN_ZOOM, type Size } from "./window"

/** Native window colour behind the renderer, matching each theme's canvas. */
export const themeBackground: Readonly<Record<AppTheme, string>> = { dark: "#07080a", light: "#f3f0e7" }

/** The desktop's own preferences; the backend profile keeps other keys in the same file. */
export interface DesktopSettings {
	theme: AppTheme
	/** Window content size, before the message log grew it; null opens at the default. */
	window: Size | null
	zoom: number
}

export function isAppTheme(value: unknown): value is AppTheme {
	return value === "dark" || value === "light"
}

function isSize(value: unknown): value is Size {
	if (typeof value !== "object" || value === null) return false
	const { width, height } = value as Record<string, unknown>
	return typeof width === "number" && typeof height === "number" && Number.isFinite(width) && Number.isFinite(height)
		&& width > 0 && height > 0
}

export function isZoom(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= MIN_ZOOM && value <= MAX_ZOOM
}

function settingsFile(profile: string): string {
	return path.join(profile, "settings.json")
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
		window: isSize(saved.window) ? { width: saved.window.width, height: saved.window.height } : null,
		zoom: isZoom(saved.zoom) ? saved.zoom : 1,
	}
}

/**
 * Save preferences into settings.json, keeping the other keys: the backend
 * profile keeps its installation identity and ports in the same file.
 */
export function saveSettings(profile: string, changes: Partial<DesktopSettings>): void {
	const file = settingsFile(profile)
	// An unreadable file throws rather than being replaced, so its identity survives.
	const settings: unknown = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}
	if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
		throw new Error("settings.json does not contain an object.")
	}
	writeFileSync(`${file}.tmp`, `${JSON.stringify({ ...settings, ...changes }, null, 2)}\n`, { mode: 0o600 })
	renameSync(`${file}.tmp`, file)
}
