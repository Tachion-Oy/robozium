// Read and refresh the backend's dependency monitor records.
// useDependencies owns the view's state; requests here have no local state.
import { ApiError, type DesktopApiClient } from "../api/client"

// Contract from web/lib/robozium/wire.ts at 076b2c9; kinds and reasons stay open for new values.
export type DependencyStatus = "pending" | "available" | "unavailable"
export interface DependencyRecord {
	dependency_id: string
	kind: string
	redacted_metadata: Record<string, string>
	status: DependencyStatus
	checked_at: string | null
	latency_ms: number | null
	reason_code: string | null
	message: string | null
}

type Fields = Record<string, unknown>

function malformed(): never {
	throw new ApiError("malformed", "The backend returned invalid dependency records.")
}

function record(value: unknown): Fields {
	if (!value || typeof value !== "object" || Array.isArray(value)) malformed()
	return value as Fields
}

function text(fields: Fields, key: string): string {
	const value = fields[key]
	return typeof value === "string" ? value : malformed()
}

function optional<T>(fields: Fields, key: string, type: "string" | "number"): T | null {
	const value = fields[key]
	return value === null || value === undefined ? null : typeof value === type ? value as T : malformed()
}

function parseRecord(value: unknown): DependencyRecord {
	const fields = record(value)
	const status = fields.status
	if (status !== "pending" && status !== "available" && status !== "unavailable") malformed()
	const metadata = Object.entries(record(fields.redacted_metadata))
	if (!metadata.every(([, item]) => typeof item === "string")) malformed()
	return {
		dependency_id: text(fields, "dependency_id"), kind: text(fields, "kind"),
		redacted_metadata: Object.fromEntries(metadata) as Record<string, string>, status,
		checked_at: optional(fields, "checked_at", "string"), latency_ms: optional(fields, "latency_ms", "number"),
		reason_code: optional(fields, "reason_code", "string"), message: optional(fields, "message", "string"),
	}
}

function parseRecords(value: unknown): DependencyRecord[] {
	return Array.isArray(value) ? value.map(parseRecord) : malformed()
}

export async function listDependencies(client: DesktopApiClient, signal: AbortSignal): Promise<DependencyRecord[]> {
	return parseRecords(await client.request("/admin/dependencies", { signal }))
}

/** Each probe may take the monitor's 20-second timeout; they run in parallel. */
export const CHECK_TIMEOUT_MS = 30_000

/** Probes every dependency now and returns the updated records. */
export async function checkDependencies(client: DesktopApiClient, signal: AbortSignal): Promise<DependencyRecord[]> {
	return parseRecords(await client.request("/admin/dependencies/check", { method: "POST", signal }))
}
