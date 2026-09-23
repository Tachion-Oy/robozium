"use client"

import { use, useState } from "react"
import { getModelSelection, selectModel } from "@/lib/robozium/client"
import type { ModelSelection } from "@/lib/robozium/wire"
import { showErrorToast } from "@/app/components/feedback/ErrorToast"
import { SelectorDropdown } from "./SelectorDropdown"

type ModelSelectorProps = {
	initialSelection: Promise<ModelSelection | null>
	runId?: string | null
}

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

export function ModelSelector({
	initialSelection,
	runId = null,
}: ModelSelectorProps) {
	const loadedSelection = use(initialSelection)
	const [selection, setSelection] = useState<ModelSelection | null>(loadedSelection)
	const [isLoading, setIsLoading] = useState(false)
	const [isSaving, setIsSaving] = useState(false)

	const refresh = async (signal?: AbortSignal) => {
		setIsLoading(true)
		try {
			setSelection(await getModelSelection({ signal, runId }))
		} catch {
			// A failed read leaves the selector visible and retryable on next open.
		} finally {
			if (!signal?.aborted) setIsLoading(false)
		}
	}

	const selected = selection?.models.find(
		(model) => model.model_id === selection.selected_model_id,
	)

	const choose = async (modelId: string) => {
		if (isSaving) return false
		if (modelId === selection?.selected_model_id) return true
		setIsSaving(true)
		try {
			setSelection(
				await selectModel({
					model_id: modelId,
					...(runId ? { run_id: runId } : {}),
				}),
			)
			return true
		} catch {
			showErrorToast({
				title: "Model change failed",
				message: "The base model was not changed.",
				detail: "Try selecting the model again.",
			})
			return false
		} finally {
			setIsSaving(false)
		}
	}

	return (
		<SelectorDropdown
			value={selection?.selected_model_id ?? null}
			options={(selection?.models ?? []).map((model) => ({
				value: model.model_id,
				label: model.label,
				disabled: isSaving,
			}))}
			triggerLabel={selected?.label ?? "Model"}
			listboxLabel="Base model"
			onOpen={() => {
				if (!selection) void refresh()
			}}
			onSelect={choose}
			emptyContent={
				<span className="agent-hud__model-empty">
					{isLoading ? "Loading models" : "Models unavailable"}
				</span>
			}
		/>
	)
}
