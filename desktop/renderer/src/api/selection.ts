import { ApiError, type DesktopApiClient } from "./client"

// Minimal contracts adapted from web/lib/robozium/{client,wire}.ts; see the PR 7 plan.
export type Project = { slug: string }
export type ModelSelection = { models: { model_id: string; label: string }[]; selected_model_id: string }

function malformed(): never { throw new ApiError("malformed", "The backend returned an invalid selection response.") }
function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : malformed()
}
function text(value: unknown): string { return typeof value === "string" && value.trim() ? value : malformed() }
function unique(values: string[]) { if (new Set(values).size !== values.length) malformed() }

export async function listProjects(client: DesktopApiClient, signal: AbortSignal): Promise<Project[]> {
	const value = await client.request("/projects", { signal })
	if (!Array.isArray(value)) malformed()
	const projects = value.map(item => ({ slug: text(record(item).slug) }))
	unique(projects.map(project => project.slug))
	return projects
}

export async function createProject(client: DesktopApiClient, name: string, signal: AbortSignal): Promise<Project> {
	return { slug: text(record(await client.request("/projects", { method: "POST", json: { name }, signal })).slug) }
}

function modelSelection(value: unknown): ModelSelection {
	const data = record(value)
	if (!Array.isArray(data.models) || typeof data.selected_model_id !== "string") malformed()
	const models = data.models.map(item => {
		const model = record(item)
		return { model_id: text(model.model_id), label: text(model.label) }
	})
	unique(models.map(model => model.model_id))
	if (models.length && !models.some(model => model.model_id === data.selected_model_id)) malformed()
	return { models, selected_model_id: data.selected_model_id }
}

export async function getModelSelection(client: DesktopApiClient, signal: AbortSignal): Promise<ModelSelection> {
	return modelSelection(await client.request("/models", { signal }))
}

export async function selectModel(client: DesktopApiClient, modelId: string, signal: AbortSignal): Promise<ModelSelection> {
	const selected = modelSelection(await client.request("/models", { method: "POST", json: { model_id: modelId }, signal }))
	if (!selected.models.length || selected.selected_model_id !== modelId) malformed()
	return selected
}
