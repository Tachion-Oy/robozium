import type { ReactElement } from "react"
import type { ModelsState } from "../../models/useModels"
import { HudButton } from "../HudButton"

interface ModelFeedbackProps {
	models: ModelsState
	connected: boolean
	creatingRun: boolean
}

export function ModelFeedback({ models, connected, creatingRun }: ModelFeedbackProps): ReactElement {
	let message = ""
	if (models.error) message = models.error
	else if (models.pending) message = "Updating models…"
	else if (!models.selection?.models.length) message = "No models available."

	function refresh(): void {
		if (!creatingRun) models.refresh()
	}

	function retry(): void {
		if (!creatingRun) models.retry()
	}

	return (
		<div className="model-feedback">
			<p role={models.error ? "alert" : "status"}>{message}</p>
			<HudButton aria-disabled={!connected || models.pending || creatingRun} onClick={refresh}>
				Refresh models
			</HudButton>
			<HudButton aria-label="Retry model change" aria-disabled={!models.canRetry || creatingRun} onClick={retry}>
				Retry change
			</HudButton>
		</div>
	)
}
