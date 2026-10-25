// Keep the acknowledged backend model selection; choosing a model again retries a failed write.
// Reconnects refresh server state; reads and writes share one request owner. With a run,
// the selection is that run's model, as in the web HUD; without one, the default for new runs.
import { useCallback, useEffect, useState } from "react"
import type { DesktopApiClient } from "../api/client"
import { getModelSelection, selectModel, type ModelSelection } from "./models-api"
import { useRequest } from "../api/useRequest"

export interface ModelsState {
	selection: ModelSelection | undefined
	pending: boolean
	error: string
	choose: (model: string) => void
	refresh: () => void
}

export function useModels(client: DesktopApiClient, connected: boolean, runId: string | null): ModelsState {
	const [selection, setSelection] = useState<ModelSelection>()
	const [retryModel, setRetryModel] = useState<string | null>(null)
	const request = useRequest()
	const { run, cancel } = request
	const confirm = useCallback((value: ModelSelection) => {
		setSelection(value)
		setRetryModel(null)
	}, [])
	const refresh = useCallback(() => {
		if (connected) void run(signal => getModelSelection(client, runId, signal), confirm)
	}, [client, connected, runId, run, confirm])
	// Revalidate server state on recovery and when the selection's run changes.
	useEffect(() => {
		refresh()
		return cancel
	}, [refresh, cancel])
	const choose = (model: string) => {
		if (!connected || request.pending) return
		// A failed request can leave the displayed selection out of sync with the backend.
		if (model === selection?.selected_model_id && retryModel === null && !request.error) return
		void run(signal => {
			setRetryModel(model)
			return selectModel(client, model, runId, signal)
		}, confirm)
	}
	return { selection, pending: request.pending, error: request.error, choose, refresh }
}
