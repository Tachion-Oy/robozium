// Read and refresh the backend's dependency monitor records.
// useDependencies owns the view's state; requests here have no local state.
import { z } from "zod"
import { parsePayload, type DesktopApiClient } from "../api/client"

const DependencyStatus = z.enum(["pending", "available", "unavailable"])
export type DependencyStatus = z.infer<typeof DependencyStatus>
/** Absent and null both mean the monitor has no value yet. */
const unknownAs = <T>(schema: z.ZodType<T>) => schema.nullish().transform(value => value ?? null)
// Kinds and reasons stay open for new values.
const DependencyRecord = z.object({
	dependency_id: z.string(),
	kind: z.string(),
	redacted_metadata: z.record(z.string(), z.string()),
	status: DependencyStatus,
	checked_at: unknownAs(z.string()),
	latency_ms: unknownAs(z.number()),
	reason_code: unknownAs(z.string()),
	message: unknownAs(z.string()),
})
export type DependencyRecord = z.infer<typeof DependencyRecord>

const parseRecords = (value: unknown): DependencyRecord[] =>
	parsePayload(z.array(DependencyRecord), value, "The backend returned invalid dependency records.")

export async function listDependencies(client: DesktopApiClient, signal: AbortSignal): Promise<DependencyRecord[]> {
	return parseRecords(await client.request("/admin/dependencies", { signal }))
}

/** Each probe may take the monitor's 20-second timeout; they run in parallel. */
export const CHECK_TIMEOUT_MS = 30_000

/** Probes every dependency now and returns the updated records. */
export async function checkDependencies(client: DesktopApiClient, signal: AbortSignal): Promise<DependencyRecord[]> {
	return parseRecords(await client.request("/admin/dependencies/check", { method: "POST", signal }))
}
