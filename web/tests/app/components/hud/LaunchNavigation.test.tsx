import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { AgentHUD } from "../../../../app/components/hud/AgentHUD"
import { AgentApiError } from "../../../../lib/robozium/client"
import { hudVisibilityStore } from "../../../../lib/robozium/hud-visibility"

const mocks = vi.hoisted(() => ({
	push: vi.fn(), createProject: vi.fn(), createRun: vi.fn(), listCapabilities: vi.fn(),
	listProjects: vi.fn(), listDependencies: vi.fn(), getCredentialStatus: vi.fn(), showErrorToast: vi.fn(),
	getModelSelection: vi.fn(), selectModel: vi.fn(),
	getProjectCapabilitySelection: vi.fn(), saveProjectCapabilitySelection: vi.fn(),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }), useSearchParams: () => new URLSearchParams() }))
vi.mock("../../../../lib/robozium/client", async (original) => ({
	...await original<typeof import("../../../../lib/robozium/client")>(), ...mocks,
}))
vi.mock("../../../../app/components/feedback/ErrorToast", () => ({ showErrorToast: mocks.showErrorToast }))

beforeEach(() => {
	vi.resetAllMocks()
	hudVisibilityStore.setState({ open: true, navigationPending: false, runActive: false, prompting: false })
	mocks.listProjects.mockResolvedValue([{ slug: "alpha", status: "dormant", run_id: null, created_at: null }])
	mocks.listCapabilities.mockResolvedValue([
		{ name: "filesystem", kind: "skill", selectable: false, loading: "automatic" },
		{ name: "email", kind: "skill", selectable: true, loading: "on_demand" },
	])
	mocks.getProjectCapabilitySelection.mockResolvedValue(null)
	mocks.saveProjectCapabilitySelection.mockImplementation(async (_project, choices) => choices)
	mocks.listDependencies.mockResolvedValue([])
	mocks.getCredentialStatus.mockResolvedValue({ locked: false, encrypted_file_exists: false })
	mocks.createProject.mockResolvedValue({ slug: "new-project" })
	mocks.createRun.mockResolvedValue({ run_id: "new-run" })
})
afterEach(cleanup)

function selectView(name: string) {
	fireEvent.click(document.querySelector<HTMLButtonElement>(".agent-hud__view-trigger")!)
	fireEvent.click(screen.getByRole("option", { name }))
}
async function openNewProject() {
	fireEvent.click(await screen.findByRole("button", { name: "New Project" }))
	fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "  New Project  " } })
	fireEvent.click(await screen.findByRole("checkbox", { name: "email" }))
}
function submit() {
	fireEvent.click(within(screen.getByRole("form")).getByRole("button", { name: "Launch" }))
}

it.each(["before", "after"])("keeps model selection when saving finishes %s switching scopes", async (timing) => {
	const models = [{ model_id: "a", label: "Model A" }, { model_id: "b", label: "Model B" }]
	const initial = { models, selected_model_id: "a" }
	const selections = new Map([["default", initial], ["existing-run", initial]])
	let completeSave!: () => void
	const saving = new Promise<void>((resolve) => { completeSave = resolve })
	mocks.getModelSelection.mockImplementation(({ runId }) => Promise.resolve(selections.get(runId ?? "default")))
	mocks.selectModel.mockImplementation(async ({ model_id, run_id }) => {
		if (model_id === "b") await saving
		const selection = { models, selected_model_id: model_id }
		selections.set(run_id ?? "default", selection)
		return selection
	})
	await act(async () => render(<AgentHUD runId="existing-run" introDone
		modelSelectionPromise={Promise.resolve(initial)} defaultModelSelectionPromise={Promise.resolve(initial)} />))
	selectView("Runs Overview")
	await openNewProject()
	fireEvent.click(await screen.findByRole("button", { name: "Model A" }))
	fireEvent.click(screen.getByRole("option", { name: "Model B" }))
	if (timing === "before") {
		await act(async () => completeSave())
		await screen.findByRole("button", { name: "Model B" })
	}
	selectView("Dependencies")
	await screen.findByRole("button", { name: "Model A" })
	if (timing === "after") await act(async () => completeSave())
	expect(screen.getByRole("button", { name: "Model A" })).not.toBeNull()
	expect(selections.get("default")?.selected_model_id).toBe("b")
	selectView("Launch")
	fireEvent.click(await screen.findByRole("button", { name: "Model B" }))
	fireEvent.click(screen.getByRole("option", { name: "Model A" }))
	await waitFor(() => expect(mocks.selectModel).toHaveBeenLastCalledWith({ model_id: "a" }))
	expect(selections.get("default")?.selected_model_id).toBe("a")
	expect(selections.get("existing-run")?.selected_model_id).toBe("a")
})

it("retains a launch draft across unmounted screens, then submits only selected choices", async () => {
	render(<AgentHUD runId={null} introDone />)
	await openNewProject()
	const firstForm = screen.getByRole("form")
	selectView("Dependencies")
	expect(firstForm.isConnected).toBe(false)
	selectView("Runs Overview")
	await screen.findByRole("button", { name: "New Project" })
	selectView("Launch")
	expect((screen.getByLabelText("Project name") as HTMLInputElement).value).toBe("  New Project  ")
	expect((await screen.findByRole("checkbox", { name: "email" })).getAttribute("aria-checked")).toBe("true")
	submit()
	await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/?runId=new-run"))
	expect(mocks.createProject).toHaveBeenCalledWith({ name: "New Project" })
	expect(mocks.createRun).toHaveBeenCalledWith({ project: "new-project", capabilities: { email: "on_demand" } })
	expect(screen.queryByRole("form")).toBeNull()
})

it("cancel and run changes discard drafts", async () => {
	const view = render(<AgentHUD runId={null} introDone />)
	await openNewProject()
	fireEvent.click(within(screen.getByRole("form")).getByRole("button", { name: "Cancel" }))
	fireEvent.click(await screen.findByRole("button", { name: "New Project" }))
	expect((screen.getByLabelText("Project name") as HTMLInputElement).value).toBe("")
	expect((await screen.findByRole("checkbox", { name: "email" })).getAttribute("aria-checked")).toBe("false")
	view.rerender(<AgentHUD runId="another-run" introDone />)
	selectView("Runs Overview")
	fireEvent.click(await screen.findByRole("button", { name: "New Project" }))
	expect((screen.getByLabelText("Project name") as HTMLInputElement).value).toBe("")
	expect(mocks.saveProjectCapabilitySelection).not.toHaveBeenCalled()
})

it("direct Launch restores current choices and waits for persistence before starting the run", async () => {
	mocks.getProjectCapabilitySelection.mockResolvedValue({ email: "automatic", removed: true, filesystem: false })
	let completeSave!: () => void
	mocks.saveProjectCapabilitySelection.mockReturnValue(new Promise<void>((resolve) => { completeSave = resolve }))
	render(<AgentHUD runId={null} introDone />)
	fireEvent.click(await screen.findByRole("button", { name: "Launch" }))
	await waitFor(() => expect(mocks.saveProjectCapabilitySelection).toHaveBeenCalledWith("alpha", { email: "automatic" }))
	expect(mocks.createRun).not.toHaveBeenCalled()
	await act(async () => completeSave())
	await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/?runId=new-run"))
	expect(mocks.createRun).toHaveBeenCalledWith({ project: "alpha", capabilities: { email: "automatic" } })
	expect(mocks.createProject).not.toHaveBeenCalled()
})

it("direct Launch stops on a saved-selection read failure without overwriting it", async () => {
	mocks.getProjectCapabilitySelection.mockRejectedValue(new AgentApiError(500, "Repair capabilities.json"))
	render(<AgentHUD runId={null} introDone />)
	fireEvent.click(await screen.findByRole("button", { name: "Launch" }))
	await waitFor(() => expect(mocks.showErrorToast).toHaveBeenCalledWith({ title: "Launch failed", message: "Repair capabilities.json" }))
	expect(mocks.saveProjectCapabilitySelection).not.toHaveBeenCalled()
	expect(mocks.createRun).not.toHaveBeenCalled()
	expect(hudVisibilityStore.getState().navigationPending).toBe(false)
})

it("keeps edited saved choices across screens without persisting a cancelled draft", async () => {
	mocks.getProjectCapabilitySelection.mockResolvedValue({ email: "automatic" })
	render(<AgentHUD runId={null} introDone />)
	fireEvent.click(await screen.findByRole("button", { name: "Tools" }))
	const checkbox = await screen.findByRole("checkbox", { name: "email" })
	expect(checkbox.getAttribute("aria-checked")).toBe("true")
	fireEvent.click(checkbox)
	selectView("Dependencies")
	selectView("Runs Overview")
	await screen.findByRole("button", { name: "New Project" })
	selectView("Launch")
	expect((await screen.findByRole("checkbox", { name: "email" })).getAttribute("aria-checked")).toBe("false")
	fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
	fireEvent.click(await screen.findByRole("button", { name: "Tools" }))
	expect((await screen.findByRole("checkbox", { name: "email" })).getAttribute("aria-checked")).toBe("true")
	expect(mocks.saveProjectCapabilitySelection).not.toHaveBeenCalled()
})

it.each(["save", "run"])("retries a new project after a %s failure without creating it again", async (failure) => {
	if (failure === "save") mocks.saveProjectCapabilitySelection.mockRejectedValueOnce(new AgentApiError(500, "Cannot save choices"))
	else mocks.createRun.mockRejectedValueOnce(new AgentApiError(503, "Run unavailable"))
	render(<AgentHUD runId={null} introDone />)
	await openNewProject()
	submit()
	await waitFor(() => expect(mocks.showErrorToast).toHaveBeenCalledOnce())
	await screen.findByRole("checkbox", { name: "email" })
	expect(screen.getByRole("heading", { name: "Project: new-project" })).not.toBeNull()
	expect(screen.getByRole("checkbox", { name: "email" }).getAttribute("aria-checked")).toBe("true")
	if (failure === "save") expect(mocks.createRun).not.toHaveBeenCalled()
	submit()
	await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/?runId=new-run"))
	expect(mocks.createProject).toHaveBeenCalledOnce()
	expect(mocks.saveProjectCapabilitySelection).toHaveBeenLastCalledWith("new-project", { email: "on_demand" })
	expect(mocks.createRun).toHaveBeenLastCalledWith({ project: "new-project", capabilities: { email: "on_demand" } })
})

it("a duplicate New Project never replaces existing choices", async () => {
	mocks.createProject.mockRejectedValue(new AgentApiError(409, "Project already exists. Open it from Runs Overview."))
	render(<AgentHUD runId={null} introDone />)
	await openNewProject()
	submit()
	await waitFor(() => expect(mocks.showErrorToast).toHaveBeenCalledWith(expect.objectContaining({ message: "Project already exists. Open it from Runs Overview." })))
	expect(mocks.saveProjectCapabilitySelection).not.toHaveBeenCalled()
	expect(mocks.createRun).not.toHaveBeenCalled()
	expect(screen.getByLabelText("Project name")).not.toBeNull()
})

it.each([423, 409, 503])("reports a %s failure after dismissal and releases navigation", async (status) => {
	let reject!: (reason: unknown) => void
	mocks.createRun.mockReturnValue(new Promise((_, fail) => { reject = fail }))
	render(<AgentHUD runId="existing-run" introDone />)
	selectView("Runs Overview")
	await openNewProject()
	submit()
	await waitFor(() => expect(mocks.createRun).toHaveBeenCalledOnce())
	fireEvent.keyDown(screen.getByRole("button", { name: "Toggle color theme" }), { key: "Escape" })
	expect(screen.queryByRole("form")).toBeNull()
	await act(async () => reject(new AgentApiError(status, "Launch request rejected")))
	expect(mocks.showErrorToast).toHaveBeenCalledWith(expect.objectContaining({
		title: status === 423 ? "API keys locked" : "Launch failed",
		message: status === 423 ? "Unlock API keys before starting a run." : "Launch request rejected",
	}))
	expect(hudVisibilityStore.getState().navigationPending).toBe(false)
	expect(mocks.push).not.toHaveBeenCalled()
	fireEvent.click(screen.getByRole("button", { name: "Expand" }))
	fireEvent.click(await screen.findByRole("button", { name: "New Project" }))
	expect((screen.getByLabelText("Project name") as HTMLInputElement).value).toBe("")
})

it("retains choices for retry and accepts only the first rapid submission", async () => {
	let reject!: (reason: unknown) => void
	mocks.createRun.mockReturnValueOnce(new Promise((_, fail) => { reject = fail }))
	render(<AgentHUD runId={null} introDone />)
	fireEvent.click(await screen.findByRole("button", { name: "Tools" }))
	fireEvent.click(await screen.findByRole("checkbox", { name: "email" }))
	const form = screen.getByRole("form")
	fireEvent.submit(form)
	fireEvent.submit(form)
	await waitFor(() => expect(mocks.createRun).toHaveBeenCalledOnce())
	await act(async () => reject(new Error("offline")))
	expect(screen.getByRole("checkbox", { name: "email" }).getAttribute("aria-checked")).toBe("true")
	expect(mocks.showErrorToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Launch failed" }))
	submit()
	await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/?runId=new-run"))
	expect(mocks.createRun).toHaveBeenLastCalledWith({ project: "alpha", capabilities: { email: "on_demand" } })
	expect(mocks.createProject).not.toHaveBeenCalled()
})
