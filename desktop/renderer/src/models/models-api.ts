// Read the model catalogue and validate acknowledgements of backend-default changes.
// useModels owns confirmed selection; requests here have no local state.
import { z } from "zod"
import { parsePayload, type DesktopApiClient } from "../api/client"

const identifier = z.string().refine(text => text.trim() !== "")
const AvailableModel = z.object({ model_id: identifier, label: identifier })
export type AvailableModel = z.infer<typeof AvailableModel>
const ModelSelection = z.object({ models: z.array(AvailableModel), selected_model_id: z.string() }).refine(({ models, selected_model_id }) => {
	const ids = new Set(models.map(model => model.model_id))
	return ids.size === models.length && (!models.length || ids.has(selected_model_id))
})
export type ModelSelection = z.infer<typeof ModelSelection>

const parse = (value: unknown, accept: (selection: ModelSelection) => boolean = () => true): ModelSelection =>
	parsePayload(ModelSelection.refine(accept), value, "The backend returned an invalid selection response.")

/** With a run, the run's own model; without one, the default for new runs. */
export async function getModelSelection(client: DesktopApiClient, runId: string | null, signal: AbortSignal): Promise<ModelSelection> {
	const query = runId ? `?run_id=${encodeURIComponent(runId)}` : ""
	return parse(await client.request(`/models${query}`, { signal }))
}

/** With a run, switch that run's model for its next turn; without one, set the default for new runs. */
export async function selectModel(client: DesktopApiClient, modelId: string, runId: string | null, signal: AbortSignal): Promise<ModelSelection> {
	const value = await client.request("/models", { method: "POST", json: runId ? { model_id: modelId, run_id: runId } : { model_id: modelId }, signal })
	return parse(value, selected => selected.models.length > 0 && selected.selected_model_id === modelId)
}
