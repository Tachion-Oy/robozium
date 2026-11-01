// Read and change whether encrypted secrets are loaded into the backend process.
// useCredentials owns the status; requests here have no local state.
import { ApiError, type DesktopApiClient } from "../api/client"

export interface CredentialStatus {
	available: boolean
	locked: boolean
	/** A live start with no saved settings or .env: provider actions wait for keys. */
	setupRequired: boolean
	/** An environment change applies after a restart; until then no run starts and no dependency check runs. */
	restartRequired: boolean
}

function parseCredentialStatus(value: unknown): CredentialStatus {
	if (!value || typeof value !== "object" || Array.isArray(value)
		|| !("available" in value) || typeof value.available !== "boolean"
		|| !("locked" in value) || typeof value.locked !== "boolean") {
		throw new ApiError("malformed", "The backend returned an invalid secrets status.")
	}
	// Older backends omit it; they never hold provider actions for setup.
	const setupRequired = "setup_required" in value ? value.setup_required : false
	if (typeof setupRequired !== "boolean"
		|| !("restart_required" in value) || typeof value.restart_required !== "boolean") {
		throw new ApiError("malformed", "The backend returned an invalid secrets status.")
	}
	return { available: value.available, locked: value.locked, setupRequired, restartRequired: value.restart_required }
}

export async function getCredentialStatus(client: DesktopApiClient, signal: AbortSignal): Promise<CredentialStatus> {
	return parseCredentialStatus(await client.request("/credentials", { signal }))
}

/** The password goes only into this request body; callers never keep it. */
export async function unlockCredentials(client: DesktopApiClient, password: string, signal: AbortSignal): Promise<CredentialStatus> {
	return parseCredentialStatus(await client.request("/credentials/unlock", { method: "POST", json: { password }, signal }))
}
