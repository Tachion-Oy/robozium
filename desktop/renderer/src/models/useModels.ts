// Keep the acknowledged backend model selection and an explicit failed-write retry target.
// Reconnects refresh server state; reads and writes share one request owner.
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
	canRetry: boolean
	retry: () => void
}

export function useModels(client: DesktopApiClient | null, connected: boolean): ModelsState {
	const [selection, setSelection] = useState<ModelSelection>()
	const [retryModel, setRetryModel] = useState<string | null>(null)
	const request = useRequest()
	const { run, cancel } = request
	const confirm = useCallback((value: ModelSelection) => {
		setSelection(value)
		setRetryModel(null)
	}, [])
	const refresh = useCallback(() => {
		if (client && connected) void run(signal => getModelSelection(client, signal), confirm)
	}, [client, connected, run, confirm])
	// Revalidate server state on recovery; keep the mounted application's local state.
	useEffect(() => {
		refresh()
		return cancel
	}, [refresh, cancel])
	const choose = (model: string) => {
		if (!client || !connected || request.pending) return
		// A failed request can leave the displayed selection out of sync with the backend.
		if (model === selection?.selected_model_id && retryModel === null && !request.error) return
		void run(signal => {
			setRetryModel(model)
			return selectModel(client, model, signal)
		}, confirm)
	}
	return { selection, pending: request.pending, error: request.error, choose, refresh,
		canRetry: connected && !request.pending && retryModel !== null,
		retry: () => { if (retryModel !== null) choose(retryModel) } }
}
