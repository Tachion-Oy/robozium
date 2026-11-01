// Read and refresh the backend's dependency monitor records.
// useDependencies owns the view's state; requests here have no local state.
import { z } from "zod"
import { orNull, parsePayload, type DesktopApiClient } from "../api/client"

// Kinds and reasons stay open for new values.
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

const DependencyRecords: z.ZodType<DependencyRecord[]> = z.array(z.object({
	dependency_id: z.string(),
	kind: z.string(),
	redacted_metadata: z.record(z.string(), z.string()),
	status: z.enum(["pending", "available", "unavailable"]),
	checked_at: orNull(z.string()),
	latency_ms: orNull(z.number()),
	reason_code: orNull(z.string()),
	message: orNull(z.string()),
}))

const parseRecords = (value: unknown): DependencyRecord[] =>
	parsePayload(DependencyRecords, value, "The backend returned invalid dependency records.")

export async function listDependencies(client: DesktopApiClient, signal: AbortSignal): Promise<DependencyRecord[]> {
	return parseRecords(await client.request("/admin/dependencies", { signal }))
}

/** Each probe may take the monitor's 20-second timeout; they run in parallel. */
export const CHECK_TIMEOUT_MS = 30_000

/** Probes every dependency now and returns the updated records. */
export async function checkDependencies(client: DesktopApiClient, signal: AbortSignal): Promise<DependencyRecord[]> {
	return parseRecords(await client.request("/admin/dependencies/check", { method: "POST", signal }))
}
