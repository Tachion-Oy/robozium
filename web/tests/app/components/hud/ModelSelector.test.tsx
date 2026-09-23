import { Suspense } from "react"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	getModelSelection: vi.fn(),
	selectModel: vi.fn(),
	showErrorToast: vi.fn(),
}))

vi.mock("../../../../lib/robozium/client", () => ({
	getModelSelection: mocks.getModelSelection,
	selectModel: mocks.selectModel,
}))
vi.mock("../../../../app/components/feedback/ErrorToast", () => ({
	showErrorToast: mocks.showErrorToast,
}))

import {
	ModelSelector,
	ModelSelectorLoading,
} from "../../../../app/components/hud/ModelSelector"

const glm = {
	model_id: "model:openrouter:z-ai/glm-5.3-flash",
	label: "GLM-5.3 Flash · OpenRouter",
}
const gptOss = {
	model_id: "model:cerebras:gpt-oss-120b",
	label: "GPT-OSS-120B · Cerebras",
}
const initialSelection = {
	models: [glm, gptOss],
	selected_model_id: glm.model_id,
}

async function renderSelector(
	selection: Promise<typeof initialSelection | null> = Promise.resolve(
		initialSelection,
	),
	runId: string | null = null,
) {
	await act(async () => {
		render(
			<Suspense fallback={<ModelSelectorLoading />}>
				<ModelSelector
					initialSelection={selection}
					runId={runId}
				/>
			</Suspense>,
		)
	})
}

beforeEach(() => {
	vi.clearAllMocks()
	mocks.getModelSelection.mockResolvedValue(initialSelection)
})

afterEach(() => cleanup())

describe("ModelSelector", () => {
	it("loads the current model and selects a new one from the dropdown", async () => {
		mocks.selectModel.mockResolvedValue({
			...initialSelection,
			selected_model_id: gptOss.model_id,
		})
		await renderSelector()

		const trigger = await screen.findByRole("button", {
			name: "GLM-5.3 Flash · OpenRouter",
		})
		fireEvent.click(trigger)
		expect(await screen.findByRole("listbox", { name: "Base model" })).not.toBeNull()
		fireEvent.click(screen.getByRole("option", { name: "GPT-OSS-120B · Cerebras" }))

		await waitFor(() =>
			expect(mocks.selectModel).toHaveBeenCalledWith({
				model_id: gptOss.model_id,
			}),
		)
		expect(
			await screen.findByRole("button", {
				name: "GPT-OSS-120B · Cerebras",
			}),
		).not.toBeNull()
		expect(screen.queryByRole("listbox")).toBeNull()
	})

	it("keeps the previous model and reports a failed change", async () => {
		mocks.selectModel.mockRejectedValue(new Error("offline"))
		await renderSelector()

		fireEvent.click(
			await screen.findByRole("button", { name: "GLM-5.3 Flash · OpenRouter" }),
		)
		fireEvent.click(screen.getByRole("option", { name: "GPT-OSS-120B · Cerebras" }))

		await waitFor(() =>
			expect(mocks.showErrorToast).toHaveBeenCalledWith({
				title: "Model change failed",
				message: "The base model was not changed.",
				detail: "Try selecting the model again.",
			}),
		)
		expect(screen.getByRole("button", { name: "GLM-5.3 Flash · OpenRouter" })).not.toBeNull()
		expect(screen.getByRole("listbox")).not.toBeNull()
	})

	it("scopes a model change to the active run", async () => {
		mocks.selectModel.mockResolvedValue({
			...initialSelection,
			selected_model_id: gptOss.model_id,
		})
		await renderSelector(Promise.resolve(initialSelection), "run-one")

		fireEvent.click(
			await screen.findByRole("button", { name: "GLM-5.3 Flash · OpenRouter" }),
		)
		fireEvent.click(
			screen.getByRole("option", { name: "GPT-OSS-120B · Cerebras" }),
		)

		await waitFor(() =>
			expect(mocks.selectModel).toHaveBeenCalledWith({
				model_id: gptOss.model_id,
				run_id: "run-one",
			}),
		)
	})

	it("shows a stable loading trigger until the initial models resolve", async () => {
		let resolveSelection: (selection: typeof initialSelection) => void = () => {}
		const selection = new Promise<typeof initialSelection>((resolve) => {
			resolveSelection = resolve
		})
		await renderSelector(selection)

		const loading = screen.getByRole("button", { name: "Loading models" })
		expect((loading as HTMLButtonElement).disabled).toBe(true)
		expect(loading.getAttribute("aria-busy")).toBe("true")

		await act(async () => {
			resolveSelection(initialSelection)
			await selection
		})
		const ready = await screen.findByRole("button", {
			name: "GLM-5.3 Flash · OpenRouter",
		})
		expect(ready.closest(".agent-hud__model-selector--ready")).not.toBeNull()
	})
})
