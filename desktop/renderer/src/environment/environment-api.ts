// Read and replace the runtime's saved settings and secrets (`.env.encrypt`).
// useEnvironmentDraft owns the view and its edits, useEnvironmentMutations the writes; requests here have no local state.
import { ApiError, type DesktopApiClient } from "../api/client"
import { parseCapability, type CapabilityView } from "../capabilities/capabilities-api"

export interface EnvironmentEntry {
	name: string
	/** Null for a stored secret; saving null keeps its value. */
	value: string | null
	secret: boolean
	configured: boolean
	overridden: boolean
}
export interface EnvironmentSuggestion { name: string; value: string; secret: boolean; source: string }
export interface RepositoryPackage { name: string; capabilities: CapabilityView[]; variables: string[]; active: boolean }
/** A GitHub repository whose own robozium.json lists the packages it provides; `url` is empty for a leftover folder. */
export interface EnvironmentRepository { name: string; url: string; private: boolean; packages: RepositoryPackage[] }
export interface EnvironmentView {
	revision: string
	entries: EnvironmentEntry[]
	overrides: string[]
	requires_password: boolean
	editable: boolean
	suggestions: EnvironmentSuggestion[]
	example_errors: string[]
	repositories: EnvironmentRepository[]
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

function parseRepository(value: unknown): EnvironmentRepository {
	const fields = record(value)
	return {
		name: text(fields, "name"), url: text(fields, "url"), private: flag(fields, "private"),
		packages: list(fields, "packages", item => {
			const name = record(item)
			return {
				name: text(name, "name"), capabilities: list(name, "capabilities", parseCapability),
				variables: list(name, "variables", entry => typeof entry === "string" ? entry : malformed()), active: flag(name, "active"),
			}
		}),
	}
}

function parseView(value: unknown): EnvironmentView {
	const fields = record(value)
	const names = (key: string) => list(fields, key, item => typeof item === "string" ? item : malformed())
	return {
		revision: text(fields, "revision"), entries: list(fields, "entries", parseEntry), overrides: names("overrides"),
		requires_password: flag(fields, "requires_password"), editable: flag(fields, "editable"),
		suggestions: list(fields, "suggestions", parseSuggestion), example_errors: names("example_errors"),
		repositories: list(fields, "repositories", parseRepository),
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

/** Downloading a repository and installing its dependencies can take minutes; the backend gives up first. */
export const REPOSITORY_TIMEOUT_MS = 400_000

/** Imports every package the repository lists; a deploy key is encrypted with `password`. */
export async function addRepository(
	client: DesktopApiClient, url: string, deployKey: string, password: string, signal: AbortSignal,
): Promise<void> {
	const json = deployKey ? { url, deploy_key: deployKey, password } : { url }
	await client.request("/credentials/environment/repositories", { method: "POST", json, signal })
}

/** Replaces the repository's packages with what it lists now, all or none. */
export async function updateRepository(client: DesktopApiClient, name: string, signal: AbortSignal): Promise<void> {
	await client.request(`/credentials/environment/repositories/${encodeURIComponent(name)}/update`, { method: "POST", signal })
}

export async function removeRepository(client: DesktopApiClient, name: string, signal: AbortSignal): Promise<void> {
	await client.request(`/credentials/environment/repositories/${encodeURIComponent(name)}`, { method: "DELETE", signal })
}

export async function resetEnvironment(client: DesktopApiClient, signal: AbortSignal): Promise<void> {
	await client.request("/credentials/environment", { method: "DELETE", signal })
}
