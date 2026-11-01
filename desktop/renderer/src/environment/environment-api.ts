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
export interface EnvironmentImport { name: string; capabilities: CapabilityView[]; variables: string[]; active: boolean }
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

function parseImport(value: unknown): EnvironmentImport {
	const fields = record(value)
	return {
		name: text(fields, "name"), capabilities: list(fields, "capabilities", parseCapability),
		variables: list(fields, "variables", item => typeof item === "string" ? item : malformed()), active: flag(fields, "active"),
	}
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

const CATALOG_FILE = "robozium.json"

/**
 * Keeps the folder's robozium.json and only the packages and example files it lists,
 * so a whole checkout (virtual environments, builds, tests) is never uploaded.
 * The backend validates the catalog itself; unreadable entries are left for it to reject.
 */
async function listedFiles(files: File[]): Promise<File[]> {
	const inFolder = (file: File) => file.webkitRelativePath.split("/").slice(1).join("/")
	const catalog = files.find(file => inFolder(file) === CATALOG_FILE)
	if (!catalog) throw new Error(`${CATALOG_FILE} is missing at the folder root`)
	let declared: unknown
	try {
		declared = JSON.parse(await catalog.text())
	} catch {
		throw new Error(`${CATALOG_FILE} is not valid JSON`)
	}
	const paths = (key: string) => {
		const value = typeof declared === "object" && declared !== null ? (declared as Record<string, unknown>)[key] : undefined
		return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
	}
	const packages = [...paths("tools"), ...paths("skills")]
	const listed = new Set([CATALOG_FILE, ...paths("env")])
	return files.filter(file => {
		const relative = inFolder(file)
		return listed.has(relative) || packages.some(path => relative.startsWith(`${path}/`))
	})
}

/** Uploads the parts of one folder its catalog lists; each file keeps its path inside the folder. */
export async function importEnvironment(client: DesktopApiClient, files: File[], signal: AbortSignal): Promise<EnvironmentImportResult> {
	const form = new FormData()
	for (const file of await listedFiles(files)) form.append("files", file, file.webkitRelativePath)
	const fields = record(await client.request("/credentials/environment/import", { method: "POST", form, signal }))
	return { imported: parseImport(fields.imported), suggestions: list(fields, "suggestions", parseSuggestion) }
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
