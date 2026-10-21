// Read and change whether encrypted secrets are loaded into the backend process.
// useCredentials owns the status; requests here have no local state.
import { ApiError, type DesktopApiClient } from "../api/client"

// Contract from web/lib/robozium/wire.ts at 076b2c9.
export interface CredentialStatus { available: boolean; locked: boolean; removable: boolean }

function parseCredentialStatus(value: unknown): CredentialStatus {
	if (!value || typeof value !== "object" || Array.isArray(value)
		|| !("available" in value) || typeof value.available !== "boolean"
		|| !("locked" in value) || typeof value.locked !== "boolean"
		|| !("removable" in value) || typeof value.removable !== "boolean") {
		throw new ApiError("malformed", "The backend returned an invalid secrets status.")
	}
	return { available: value.available, locked: value.locked, removable: value.removable }
}

export async function getCredentialStatus(client: DesktopApiClient, signal: AbortSignal): Promise<CredentialStatus> {
	return parseCredentialStatus(await client.request("/credentials", { signal }))
}

/** The password goes only into this request body; callers never keep it. */
export async function unlockCredentials(client: DesktopApiClient, password: string, signal: AbortSignal): Promise<CredentialStatus> {
	return parseCredentialStatus(await client.request("/credentials/unlock", { method: "POST", json: { password }, signal }))
}

export async function clearCredentials(client: DesktopApiClient, signal: AbortSignal): Promise<CredentialStatus> {
	return parseCredentialStatus(await client.request("/credentials/clear", { method: "POST", signal }))
}
