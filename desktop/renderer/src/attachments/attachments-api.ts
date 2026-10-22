// Stage images for a run's next reply (`/run/{id}/files`) and address hub files.
// The reply image draft owns the queue; requests here have no local state.
import { ApiError, type DesktopApiClient } from "../api/client"

// Contract adapted from web/lib/robozium/wire.ts (RunAttachmentSchema).
export interface RunAttachment {
	id: string
	name: string
	/** Hub-relative; readable through /files until the run's workers stop. */
	path: string
	/** The client's upload identity, so a retried upload can be matched. */
	uploadId: string | null
}

function malformed(): never {
	throw new ApiError("malformed", "The backend returned an invalid image attachment.")
}

function parseAttachment(value: unknown): RunAttachment {
	if (!value || typeof value !== "object" || Array.isArray(value)) malformed()
	const { id, name, path, upload_id: uploadId = null } = value as Record<string, unknown>
	if (typeof id !== "string" || !id || typeof name !== "string" || typeof path !== "string" || !path) malformed()
	if (uploadId !== null && typeof uploadId !== "string") malformed()
	return { id, name, path, uploadId }
}

const filesPath = (runId: string) => `/run/${encodeURIComponent(runId)}/files`

export async function listRunAttachments(client: DesktopApiClient, runId: string, signal: AbortSignal): Promise<RunAttachment[]> {
	const value = await client.request(filesPath(runId), { signal })
	if (!Array.isArray(value)) malformed()
	return value.map(parseAttachment)
}

/** Reuse uploadId when retrying one selection; the backend then returns the same attachment. */
export async function uploadRunAttachment(
	client: DesktopApiClient, runId: string, file: File, uploadId: string, signal: AbortSignal,
): Promise<RunAttachment> {
	const query = new URLSearchParams({ filename: file.name, upload_id: uploadId })
	return parseAttachment(await client.request(`${filesPath(runId)}?${query}`, { method: "POST", bytes: file, signal }))
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
