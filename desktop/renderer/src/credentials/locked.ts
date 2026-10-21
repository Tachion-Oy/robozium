// The backend refuses provider work with HTTP 423 while encrypted secrets are locked.
import { ApiError } from "../api/client"
import { showErrorToast } from "../feedback/notices"

export function isSecretsLocked(error: unknown): boolean {
	return error instanceof ApiError && error.status === 423
}

/** The reference notice; the header's Secrets menu is where the user unlocks. */
export function showSecretsLocked(message: string): void {
	showErrorToast({ title: "Secrets locked", message, detail: "Open the Secrets locked menu and enter your password." })
}
