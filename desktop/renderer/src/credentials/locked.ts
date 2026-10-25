// The backend refuses provider work with HTTP 423 while encrypted secrets are locked.
import { ApiError } from "../api/client"
import { showErrorToast } from "../feedback/notices"
import type { CredentialsState } from "./useCredentials"

/** What a provider write needs from the secrets owner. */
export type SecretsGate = Pick<CredentialsState, "ensureUnlocked" | "prompt" | "refresh">

export function isSecretsLocked(error: unknown): boolean {
	return error instanceof ApiError && error.status === 423
}

/** The reference notice, for a password request the user cancelled. */
export function showSecretsLocked(message: string): void {
	showErrorToast({ title: "Secrets locked", message })
}

/** A write refused as locked despite the known status: read it again and ask for the password. */
export async function promptAfterRefusal(secrets: SecretsGate, message: string): Promise<void> {
	secrets.refresh()
	if (!await secrets.prompt()) showSecretsLocked(message)
}
