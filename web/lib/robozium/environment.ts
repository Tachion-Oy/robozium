export type EnvironmentEntry = {
	name: string
	value: string | null
	secret: boolean
	configured: boolean
	overridden: boolean
	startup: boolean
}
export type EnvironmentSuggestion = { name: string; value: string; secret: boolean; source: string }
export type EnvironmentView = {
	revision: string
	entries: EnvironmentEntry[]
	overrides: string[]
	requires_password: boolean
	restart_available: boolean
	operation: string
	generation: string
	boot_error: string
	editable: boolean
	suggestions: EnvironmentSuggestion[]
	example_errors: string[]
}
export type EnvironmentEdit = {
	revision: string
	entries: Pick<EnvironmentEntry, "name" | "value" | "secret">[]
	password: string | null
}
export async function getEnvironment(signal?: AbortSignal): Promise<EnvironmentView> {
	const response = await fetch("/api/admin/environment", { cache: "no-store", signal })
	if (!response.ok) throw new Error("Could not read environment settings")
	return response.json() as Promise<EnvironmentView>
}
export async function saveEnvironment(edit: EnvironmentEdit): Promise<{ web_port: number | null }> {
	const response = await fetch("/api/admin/environment", {
		method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(edit),
	})
	if (!response.ok) {
		const result = await response.json() as { detail?: string }
		throw new Error(result.detail ?? "Could not save environment settings")
	}
	return response.json() as Promise<{ web_port: number | null }>
}
