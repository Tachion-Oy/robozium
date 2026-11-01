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
/** Where a package imported from GitHub came from; folder imports have none. */
export interface RepositorySource { repository: string; ref: string | null; commit: string; path: string }
export interface EnvironmentImport {
	name: string
	capabilities: CapabilityView[]
	variables: string[]
	active: boolean
	source: RepositorySource | null
}
export interface EnvironmentView {
	revision: string
	entries: EnvironmentEntry[]
	overrides: string[]
	requires_password: boolean
	editable: boolean
	suggestions: EnvironmentSuggestion[]
	example_errors: string[]
	imports: EnvironmentImport[]
}
export interface EnvironmentImportResult { imported: EnvironmentImport; suggestions: EnvironmentSuggestion[] }
export interface RepositoryPackage { path: string; name: string; description: string | null; installed: boolean }
/** A repository's robozium.json at the commit an import will download. */
export interface RepositoryPreview { repository: string; ref: string | null; commit: string; packages: RepositoryPackage[] }
export interface RepositoryImport {
	url: string
	commit: string
	paths: string[]
	/** A read-only GitHub token, saved encrypted with `password` for later updates. */
	token: string | null
	password: string | null
}
export interface RepositoryImportResult { imported: EnvironmentImport[]; suggestions: EnvironmentSuggestion[] }
export interface RepositoryUpdateResult extends RepositoryImportResult { updated: boolean; commit: string }
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

function optionalText(fields: Fields, key: string): string | null {
	const value = fields[key]
	return value === null || value === undefined ? null : typeof value === "string" ? value : malformed()
}

function parseSource(value: unknown): RepositorySource | null {
	if (value === null || value === undefined) return null
	const fields = record(value)
	return { repository: text(fields, "repository"), ref: optionalText(fields, "ref"), commit: text(fields, "commit"), path: text(fields, "path") }
}

function parseImport(value: unknown): EnvironmentImport {
	const fields = record(value)
	return {
		name: text(fields, "name"), capabilities: list(fields, "capabilities", parseCapability),
		variables: list(fields, "variables", item => typeof item === "string" ? item : malformed()), active: flag(fields, "active"),
		source: parseSource(fields.source),
	}
}

function parsePackage(value: unknown): RepositoryPackage {
	const fields = record(value)
	return { path: text(fields, "path"), name: text(fields, "name"), description: optionalText(fields, "description"), installed: flag(fields, "installed") }
}

function parseImports(fields: Fields): RepositoryImportResult {
	return { imported: list(fields, "imported", parseImport), suggestions: list(fields, "suggestions", parseSuggestion) }
}

function parseView(value: unknown): EnvironmentView {
	const fields = record(value)
	const names = (key: string) => list(fields, key, item => typeof item === "string" ? item : malformed())
	return {
		revision: text(fields, "revision"), entries: list(fields, "entries", parseEntry), overrides: names("overrides"),
		requires_password: flag(fields, "requires_password"), editable: flag(fields, "editable"),
		suggestions: list(fields, "suggestions", parseSuggestion), example_errors: names("example_errors"),
		imports: list(fields, "imports", parseImport),
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

/** The backend may install a tool's dependencies first; it gives up after 180 seconds. */
export const IMPORT_TIMEOUT_MS = 200_000

/** Uploads one folder; each file keeps its path inside the folder. */
export async function importEnvironment(client: DesktopApiClient, files: File[], signal: AbortSignal): Promise<EnvironmentImportResult> {
	const form = new FormData()
	for (const file of files) form.append("files", file, file.webkitRelativePath)
	const fields = record(await client.request("/credentials/environment/import", { method: "POST", form, signal }))
	return { imported: parseImport(fields.imported), suggestions: list(fields, "suggestions", parseSuggestion) }
}

/** Reads a repository's index without downloading code; a token is needed only for a private repository. */
export async function previewRepository(
	client: DesktopApiClient, url: string, token: string | null, signal: AbortSignal,
): Promise<RepositoryPreview> {
	const fields = record(await client.request("/credentials/environment/repository/preview", { method: "POST", json: { url, token }, signal }))
	return {
		repository: text(fields, "repository"), ref: optionalText(fields, "ref"), commit: text(fields, "commit"),
		packages: list(fields, "packages", parsePackage),
	}
}

/** Downloads the chosen folders at the previewed commit; like a folder import, it may install dependencies first. */
export async function importRepository(client: DesktopApiClient, request: RepositoryImport, signal: AbortSignal): Promise<RepositoryImportResult> {
	return parseImports(record(await client.request("/credentials/environment/repository/import", { method: "POST", json: request, signal })))
}

/** Replaces every package from one repository with its latest commit, or reports it is up to date. */
export async function updateRepository(client: DesktopApiClient, repository: string, signal: AbortSignal): Promise<RepositoryUpdateResult> {
	const fields = record(await client.request("/credentials/environment/repository/update", { method: "POST", json: { repository }, signal }))
	if (typeof fields.updated !== "boolean") malformed()
	return { ...parseImports(fields), updated: fields.updated, commit: text(fields, "commit") }
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

/** Deletes an imported package's copy; its capabilities stay loaded until restart. */
export async function removeEnvironmentImport(client: DesktopApiClient, name: string, signal: AbortSignal): Promise<void> {
	await client.request(`/credentials/environment/imports/${encodeURIComponent(name)}`, { method: "DELETE", signal })
}

export async function resetEnvironment(client: DesktopApiClient, signal: AbortSignal): Promise<void> {
	await client.request("/credentials/environment", { method: "DELETE", signal })
}
