// Read and replace the runtime's saved settings and secrets (`.env.encrypt`).
// useEnvironmentDraft owns the view and its edits, useEnvironmentMutations the writes; requests here have no local state.
import { z } from "zod"
import { type DesktopApiClient } from "../api/client"
import { parsePayload } from "../api/payload"
import { CapabilityView } from "../capabilities/capabilities-api"

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

const EnvironmentEntry: z.ZodType<EnvironmentEntry> = z.object({
	name: z.string(), value: z.string().nullable(), secret: z.boolean(), configured: z.boolean(), overridden: z.boolean(),
})
const EnvironmentSuggestion: z.ZodType<EnvironmentSuggestion> = z.object({
	name: z.string(), value: z.string(), secret: z.boolean(), source: z.string(),
})
const EnvironmentImport: z.ZodType<EnvironmentImport> = z.object({
	name: z.string(), capabilities: z.array(CapabilityView), variables: z.array(z.string()), active: z.boolean(),
})
const EnvironmentView: z.ZodType<EnvironmentView> = z.object({
	revision: z.string(),
	entries: z.array(EnvironmentEntry),
	overrides: z.array(z.string()),
	requires_password: z.boolean(),
	editable: z.boolean(),
	suggestions: z.array(EnvironmentSuggestion),
	example_errors: z.array(z.string()),
	imports: z.array(EnvironmentImport),
})
const EnvironmentImportResult: z.ZodType<EnvironmentImportResult> = z.object({
	imported: EnvironmentImport, suggestions: z.array(EnvironmentSuggestion),
})
const Saved = z.object({ status: z.literal("saved") })
const Replaced = z.object({ status: z.literal("replaced"), loaded: z.boolean() })

const parse = <T>(schema: z.ZodType<T>, value: unknown): T =>
	parsePayload(schema, value, "The backend returned invalid environment settings.")

export async function getEnvironment(client: DesktopApiClient, signal: AbortSignal): Promise<EnvironmentView> {
	return parse(EnvironmentView, await client.request("/credentials/environment", { signal }))
}

/** Replaces every entry; a stale revision is refused with 409. */
export async function saveEnvironment(client: DesktopApiClient, edit: EnvironmentEdit, signal: AbortSignal): Promise<void> {
	parse(Saved, await client.request("/credentials/environment", { method: "POST", json: edit, signal }))
}

/** The backend may install a tool's dependencies first; it gives up after 180 seconds. */
export const IMPORT_TIMEOUT_MS = 200_000

/** Uploads one folder; each file keeps its path inside the folder. */
export async function importEnvironment(client: DesktopApiClient, files: File[], signal: AbortSignal): Promise<EnvironmentImportResult> {
	const form = new FormData()
	for (const file of files) form.append("files", file, file.webkitRelativePath)
	return parse(EnvironmentImportResult, await client.request("/credentials/environment/import", { method: "POST", form, signal }))
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
	const value = await client.request("/credentials/environment/file", { method: "POST", form, signal })
	const { loaded } = parse(Replaced, value)
	return { loaded }
}

/** Deletes an imported package's copy; its capabilities stay loaded until restart. */
export async function removeEnvironmentImport(client: DesktopApiClient, name: string, signal: AbortSignal): Promise<void> {
	await client.request(`/credentials/environment/imports/${encodeURIComponent(name)}`, { method: "DELETE", signal })
}

export async function resetEnvironment(client: DesktopApiClient, signal: AbortSignal): Promise<void> {
	await client.request("/credentials/environment", { method: "DELETE", signal })
}
