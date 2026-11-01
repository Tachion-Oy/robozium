// Read and change whether encrypted secrets are loaded into the backend process.
// useCredentials owns the status; requests here have no local state.
import { z } from "zod"
import { parsePayload, type DesktopApiClient } from "../api/client"

const CredentialStatus = z.object({ available: z.boolean(), locked: z.boolean(), setup_required: z.boolean() })
	.transform(({ available, locked, setup_required: setupRequired }) => ({ available, locked, setupRequired }))
/** `setupRequired` marks a live start with no saved settings or .env: provider actions wait for keys. */
export type CredentialStatus = z.infer<typeof CredentialStatus>

const parseCredentialStatus = (value: unknown): CredentialStatus =>
	parsePayload(CredentialStatus, value, "The backend returned an invalid secrets status.")

export async function getCredentialStatus(client: DesktopApiClient, signal: AbortSignal): Promise<CredentialStatus> {
	return parseCredentialStatus(await client.request("/credentials", { signal }))
}

/** The password goes only into this request body; callers never keep it. */
export async function unlockCredentials(client: DesktopApiClient, password: string, signal: AbortSignal): Promise<CredentialStatus> {
	return parseCredentialStatus(await client.request("/credentials/unlock", { method: "POST", json: { password }, signal }))
}
