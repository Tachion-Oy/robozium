// useModels owns the selection, requests and acknowledgements,
// and ModelLabel draws the speed tier as an icon.
import type { ModelsState } from "../../models/useModels"
import { ModelLabel } from "./ModelLabel"
import { SelectorDropdown } from "./SelectorDropdown"

export function ModelSelectorLoading() {
	return (
		<div className="agent-hud__model-selector agent-hud__model-selector--loading">
			<button
				type="button"
				className="agent-hud__selector-trigger agent-hud__model-trigger"
				disabled
				aria-busy="true">
				<span>Loading models</span>
			</button>
		</div>
	)
}

export function ModelSelector({ models, disabled = false }: {
	models: ModelsState
	disabled?: boolean
}) {
	const { selection, pending } = models
	if (!selection && pending) return <ModelSelectorLoading />
	const selected = selection?.models.find(
		(model) => model.model_id === selection.selected_model_id,
	)

	return (
		<SelectorDropdown
			value={selection?.selected_model_id ?? null}
			options={(selection?.models ?? []).map((model) => ({
				value: model.model_id,
				label: model.label,
				disabled: pending,
			}))}
			triggerLabel={selected?.label ?? "Model"}
			listboxLabel="Base model"
			renderLabel={(label) => <ModelLabel label={label} />}
			disabled={disabled}
			onOpen={() => {
				// As in the reference, plus after a failed request or an empty catalogue,
				// so opening the selector replaces the removed manual refresh.
				if (!selection?.models.length || models.error) models.refresh()
			}}
			onSelect={(modelId) => {
				// The owner acknowledges the change; a failure keeps the confirmed model.
				models.choose(modelId)
				return true
			}}
			emptyContent={
				<span className="agent-hud__model-empty">
					{pending ? "Loading models" : "Models unavailable"}
				</span>
			}
		/>
	)
}
