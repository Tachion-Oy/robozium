// Adapted from #101 (feat/desktop-run-interactions at 4a759b5): without a selected project.
// Store only local recovery intent. History and prompts always come from the backend.
import type { BackendMode } from "../../../src/bridge"

export interface RecoveryRecord {
	version: 1
	/** The run Current Run showed; null once it ended or went missing. */
	run: { id: string; project: string } | null
	draft: string
}

export function emptyRecovery(): RecoveryRecord {
	return { version: 1, run: null, draft: "" }
}

export function recoveryKey(mode: BackendMode): string {
	return `robozium.desktop.recovery.v1.${mode}`
}

export function parseRecovery(text: string): RecoveryRecord {
	const value: unknown = JSON.parse(text)
	if (!value || typeof value !== "object" || Array.isArray(value)
		|| !("version" in value) || value.version !== 1
		|| !("draft" in value) || typeof value.draft !== "string"
		|| !("run" in value)) throw new Error("Invalid recovery record.")
	return { version: 1, draft: value.draft, run: parseRunIdentity(value.run) }
}

function parseRunIdentity(value: unknown): RecoveryRecord["run"] {
	if (value === null) return null
	if (!value || typeof value !== "object" || Array.isArray(value)
		|| !("id" in value) || typeof value.id !== "string" || !value.id.trim()
		|| !("project" in value) || typeof value.project !== "string" || !value.project.trim()) {
		throw new Error("Invalid recovery run identity.")
	}
	return { id: value.id, project: value.project }
}
