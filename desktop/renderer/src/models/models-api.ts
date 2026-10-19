// Read the model catalogue and validate acknowledgements of backend-default changes.
// useModels owns confirmed selection; requests here have no local state.
import { ApiError, type DesktopApiClient } from "../api/client"

// Minimal contracts adapted from web/lib/robozium/{client,wire}.ts; see the PR 7 plan.
export interface AvailableModel { model_id: string; label: string }
export interface ModelSelection { models: AvailableModel[]; selected_model_id: string }

function malformed(): never {
	throw new ApiError("malformed", "The backend returned an invalid selection response.")
}

function parseModel(value: unknown): AvailableModel {
	if (!value || typeof value !== "object" || Array.isArray(value)) malformed()
	if (!("model_id" in value) || typeof value.model_id !== "string" || !value.model_id.trim()) malformed()
	if (!("label" in value) || typeof value.label !== "string" || !value.label.trim()) malformed()
	return { model_id: value.model_id, label: value.label }
}

function parseModelSelection(value: unknown): ModelSelection {
	if (!value || typeof value !== "object" || Array.isArray(value)) malformed()
	if (!("models" in value) || !Array.isArray(value.models)) malformed()
	if (!("selected_model_id" in value) || typeof value.selected_model_id !== "string") malformed()
	const models = value.models.map(parseModel)
	const ids = new Set(models.map(model => model.model_id))
	if (ids.size !== models.length) malformed()
	if (models.length && !ids.has(value.selected_model_id)) malformed()
	return { models, selected_model_id: value.selected_model_id }
}

export async function getModelSelection(client: DesktopApiClient, signal: AbortSignal): Promise<ModelSelection> {
	return parseModelSelection(await client.request("/models", { signal }))
}

export async function selectModel(client: DesktopApiClient, modelId: string, signal: AbortSignal): Promise<ModelSelection> {
	const value = await client.request("/models", { method: "POST", json: { model_id: modelId }, signal })
	const selected = parseModelSelection(value)
	if (!selected.models.length || selected.selected_model_id !== modelId) malformed()
	return selected
}
