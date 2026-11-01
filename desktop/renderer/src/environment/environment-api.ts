// Read and replace the runtime's saved settings and secrets (`.env.encrypt`).
// useEnvironmentDraft owns the view and its edits, useEnvironmentMutations the writes; requests here have no local state.
import { ApiError, type DesktopApiClient } from "../api/client"

export interface EnvironmentEntry {
	name: string
	/** Null for a stored secret; saving null keeps its value. */
	value: string | null
	secret: boolean
	configured: boolean
	overridden: boolean
}
export interface EnvironmentSuggestion { name: string; value: string; secret: boolean; source: string }
export interface EnvironmentView {
	revision: string
	entries: EnvironmentEntry[]
	overrides: string[]
	requires_password: boolean
	editable: boolean
	suggestions: EnvironmentSuggestion[]
	example_errors: string[]
}
export interface EnvironmentEdit {
	revision: string
	entries: Pick<EnvironmentEntry, "name" | "value" | "secret">[]
	/** Used only to encrypt this save; never kept by the app. */
	password: string | null
}

type Fields = Record<string, unknown>

function malformed(): never {
	throw new ApiError("malformed", "The backend returned invalid environment settings.")
}

function record(value: unknown): Fields {
	if (!value || typeof value !== "object" || Array.isArray(value)) malformed()
	return value as Fields
}

function text(fields: Fields, key: string): string {
	const value = fields[key]
	return typeof value === "string" ? value : malformed()
}

function flag(fields: Fields, key: string): boolean {
	const value = fields[key]
	return typeof value === "boolean" ? value : malformed()
}

function list<T>(fields: Fields, key: string, parse: (value: unknown) => T): T[] {
	const value = fields[key]
	return Array.isArray(value) ? value.map(parse) : malformed()
}

function parseEntry(value: unknown): EnvironmentEntry {
	const fields = record(value)
	const stored = fields.value
	if (stored !== null && typeof stored !== "string") malformed()
	return {
		name: text(fields, "name"), value: stored, secret: flag(fields, "secret"),
		configured: flag(fields, "configured"), overridden: flag(fields, "overridden"),
	}
}

function parseSuggestion(value: unknown): EnvironmentSuggestion {
	const fields = record(value)
	return { name: text(fields, "name"), value: text(fields, "value"), secret: flag(fields, "secret"), source: text(fields, "source") }
}

function parseView(value: unknown): EnvironmentView {
	const fields = record(value)
	const names = (key: string) => list(fields, key, item => typeof item === "string" ? item : malformed())
	return {
		revision: text(fields, "revision"), entries: list(fields, "entries", parseEntry), overrides: names("overrides"),
		requires_password: flag(fields, "requires_password"), editable: flag(fields, "editable"),
		suggestions: list(fields, "suggestions", parseSuggestion), example_errors: names("example_errors"),
	}
}

export async function getEnvironment(client: DesktopApiClient, signal: AbortSignal): Promise<EnvironmentView> {
	return parseView(await client.request("/credentials/environment", { signal }))
}

/** Replaces every entry; a stale revision is refused with 409. */
export async function saveEnvironment(client: DesktopApiClient, edit: EnvironmentEdit, signal: AbortSignal): Promise<void> {
	const value = record(await client.request("/credentials/environment", { method: "POST", json: edit, signal }))
	if (value.status !== "saved") malformed()
}

/**
 * Adopts a whole saved-settings file, such as an existing .env.encrypt; the
 * backend accepts it only if the password opens its secrets. `loaded` is true
 * when first-start setup loaded the keys at once; otherwise they apply after a restart.
 */
export async function replaceEnvironmentFile(
	client: DesktopApiClient, file: File, revision: string, password: string, signal: AbortSignal,
): Promise<{ loaded: boolean }> {
	const form = new FormData()
	form.append("file", file, file.name)
	form.append("revision", revision)
	if (password) form.append("password", password)
	const fields = record(await client.request("/credentials/environment/file", { method: "POST", form, signal }))
	if (fields.status !== "replaced" || typeof fields.loaded !== "boolean") malformed()
	return { loaded: fields.loaded }
}

export async function resetEnvironment(client: DesktopApiClient, signal: AbortSignal): Promise<void> {
	await client.request("/credentials/environment", { method: "DELETE", signal })
}
