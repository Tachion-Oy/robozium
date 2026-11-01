// Read the model catalogue and validate acknowledgements of backend-default changes.
// useModels owns confirmed selection; requests here have no local state.
import { z } from "zod"
import { ApiError, type DesktopApiClient } from "../api/client"
import { nonBlank, parsePayload } from "../api/payload"

export interface AvailableModel { model_id: string; label: string }
export interface ModelSelection { models: AvailableModel[]; selected_model_id: string }

const MALFORMED = "The backend returned an invalid selection response."
const ModelSelection: z.ZodType<ModelSelection> = z.object({
	models: z.array(z.object({ model_id: nonBlank, label: nonBlank })),
	selected_model_id: z.string(),
}).refine(({ models, selected_model_id }) => {
	const ids = new Set(models.map(model => model.model_id))
	return ids.size === models.length && (!models.length || ids.has(selected_model_id))
})

/** With a run, the run's own model; without one, the default for new runs. */
export async function getModelSelection(client: DesktopApiClient, runId: string | null, signal: AbortSignal): Promise<ModelSelection> {
	const query = runId ? `?run_id=${encodeURIComponent(runId)}` : ""
	return parsePayload(ModelSelection, await client.request(`/models${query}`, { signal }), MALFORMED)
}

/** With a run, switch that run's model for its next turn; without one, set the default for new runs. */
export async function selectModel(client: DesktopApiClient, modelId: string, runId: string | null, signal: AbortSignal): Promise<ModelSelection> {
	const value = await client.request("/models", { method: "POST", json: runId ? { model_id: modelId, run_id: runId } : { model_id: modelId }, signal })
	const selected = parsePayload(ModelSelection, value, MALFORMED)
	if (!selected.models.length || selected.selected_model_id !== modelId) throw new ApiError("malformed", MALFORMED)
	return selected
}
