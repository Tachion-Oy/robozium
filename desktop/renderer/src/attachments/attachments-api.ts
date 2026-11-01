// Stage images for a run's next reply (`/run/{id}/files`) and address hub files.
// The reply image draft owns the queue; requests here have no local state.
import { z } from "zod"
import { type DesktopApiClient } from "../api/client"
import { nonBlank, orNull, parsePayload } from "../api/payload"

export interface RunAttachment {
	id: string
	name: string
	/** Hub-relative; readable through /files until the run's workers stop. */
	path: string
	/** The client's upload identity, so a retried upload can be matched. */
	uploadId: string | null
}

const RunAttachment: z.ZodType<RunAttachment> = z.object({ id: nonBlank, name: z.string(), path: nonBlank, upload_id: orNull(z.string()) })
	.transform(({ id, name, path, upload_id: uploadId }) => ({ id, name, path, uploadId }))
const RunAttachments = z.array(RunAttachment)

const parse = <T>(schema: z.ZodType<T>, value: unknown): T =>
	parsePayload(schema, value, "The backend returned an invalid image attachment.")

const filesPath = (runId: string) => `/run/${encodeURIComponent(runId)}/files`

export async function listRunAttachments(client: DesktopApiClient, runId: string, signal: AbortSignal): Promise<RunAttachment[]> {
	return parse(RunAttachments, await client.request(filesPath(runId), { signal }))
}

/** Reuse uploadId when retrying one selection; the backend then returns the same attachment. */
export async function uploadRunAttachment(
	client: DesktopApiClient, runId: string, file: File, uploadId: string, signal: AbortSignal,
): Promise<RunAttachment> {
	const query = new URLSearchParams({ filename: file.name, upload_id: uploadId })
	return parse(RunAttachment, await client.request(`${filesPath(runId)}?${query}`, { method: "POST", bytes: file, signal }))
}

/** Without an attachment id, removes every pending image of the run. */
export async function deleteRunAttachments(
	client: DesktopApiClient, runId: string, attachmentId: string | undefined, signal: AbortSignal,
): Promise<void> {
	const suffix = attachmentId === undefined ? "" : `/${encodeURIComponent(attachmentId)}`
	await client.request(`${filesPath(runId)}${suffix}`, { method: "DELETE", signal })
}

/** Images load it with crossorigin, so the request carries the renderer's Origin. */
export function hubFileUrl(client: DesktopApiClient, path: string): string {
	return client.url(`/files/${path.split("/").map(encodeURIComponent).join("/")}`)
}
