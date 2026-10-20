// Store only local recovery intent. History and prompts always come from the backend.
import type { BackendMode } from "../../../src/bridge"

export interface RecoveryRecord {
	version: 1
	selectedProject: string
	run: { id: string; project: string } | null
	draft: string
}

export function emptyRecovery(): RecoveryRecord {
	return { version: 1, selectedProject: "", run: null, draft: "" }
}

export function recoveryKey(mode: BackendMode): string {
	return `robozium.desktop.recovery.v1.${mode}`
}

export function parseRecovery(text: string): RecoveryRecord {
	const value: unknown = JSON.parse(text)
	if (!value || typeof value !== "object" || Array.isArray(value)
		|| !("version" in value) || value.version !== 1
		|| !("selectedProject" in value) || typeof value.selectedProject !== "string"
		|| !("draft" in value) || typeof value.draft !== "string"
		|| !("run" in value)) throw new Error("Invalid recovery record.")
	const run = parseRunIdentity(value.run)

	return {
		version: 1, selectedProject: value.selectedProject, draft: value.draft,
		run,
	}
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
