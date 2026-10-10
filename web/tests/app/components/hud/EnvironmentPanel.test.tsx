import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { EnvironmentPanel } from "@/app/components/hud/environment/EnvironmentPanel"
import type { EnvironmentView } from "@/lib/robozium/environment"

const mocks = vi.hoisted(() => ({ getEnvironment: vi.fn(), saveEnvironment: vi.fn(), unlockApiKeys: vi.fn() }))
vi.mock("@/lib/robozium/environment", () => mocks)
vi.mock("@/lib/robozium/client", () => ({ unlockApiKeys: mocks.unlockApiKeys }))
const view: EnvironmentView = {
	revision: "first", entries: [], overrides: [], requires_password: false,
	restart_available: false, operation: "idle", generation: "one", boot_error: "", editable: true,
	suggestions: [{ name: "SERVICE_API_KEY", value: "", secret: true, source: "Application/.env.example" }], example_errors: [],
}
beforeEach(() => { vi.resetAllMocks(); mocks.getEnvironment.mockResolvedValue(view); mocks.saveEnvironment.mockResolvedValue(undefined) })
afterEach(cleanup)

it("adds a suggested secret and submits its base name without creating a plaintext file", async () => {
	render(<EnvironmentPanel />)
	fireEvent.click(await screen.findByRole("button", { name: /SERVICE_API_KEY/ }))
	const value = screen.getByLabelText("Value for SERVICE_API_KEY") as HTMLInputElement
	expect(value.type).toBe("password")
	fireEvent.change(value, { target: { value: "dummy-key" } })
	fireEvent.change(screen.getByLabelText("Encryption password"), { target: { value: "dummy-password" } })
	fireEvent.change(screen.getByLabelText("Confirm encryption password"), { target: { value: "dummy-password" } })
	fireEvent.click(screen.getByRole("button", { name: "Encrypt and apply" }))
	await waitFor(() => expect(mocks.saveEnvironment).toHaveBeenCalledWith({
		revision: "first", password: "dummy-password", entries: [{ name: "SERVICE_API_KEY", value: "dummy-key", secret: true }],
	}))
	await screen.findByText(/Settings saved/)
	expect(screen.queryByDisplayValue("dummy-password")).toBeNull()
	expect(screen.queryByDisplayValue("dummy-key")).toBeNull()
})

it("disables all environment editing while runs are active", async () => {
	mocks.getEnvironment.mockResolvedValue({ ...view, editable: false })
	render(<EnvironmentPanel />)
	await screen.findByText(/Stop all runs/)
	const button = screen.getByRole("button", { name: "Add variable" }) as HTMLButtonElement
	expect(button.closest("fieldset")?.disabled).toBe(true)
	fireEvent.click(button)
	expect(screen.queryByPlaceholderText("VARIABLE_NAME")).toBeNull()
	expect(mocks.saveEnvironment).not.toHaveBeenCalled()
})

it("keeps saved secret values hidden and allows removing a row", async () => {
	mocks.getEnvironment.mockResolvedValue({ ...view, requires_password: true, entries: [{ name: "ODD", value: null, secret: true, configured: true, overridden: false, startup: false }] })
	render(<EnvironmentPanel />)
	const input = await screen.findByLabelText("Value for ODD") as HTMLInputElement
	expect(input.value).toBe("")
	expect(input.placeholder).toMatch(/Configured/)
	fireEvent.click(screen.getByRole("button", { name: "Remove ODD" }))
	expect(screen.queryByLabelText("Value for ODD")).toBeNull()
	fireEvent.change(screen.getByLabelText("Encryption password"), { target: { value: "password" } })
	fireEvent.click(screen.getByRole("button", { name: "Encrypt and apply" }))
	await waitFor(() => expect(mocks.saveEnvironment).toHaveBeenCalledWith({ revision: "first", password: "password", entries: [] }))
})

it("reserves the automatic encryption suffix and requires unique names", async () => {
	render(<EnvironmentPanel />)
	await screen.findByRole("button", { name: /SERVICE_API_KEY/ })
	fireEvent.click(screen.getByRole("button", { name: "Add variable" }))
	fireEvent.change(screen.getByPlaceholderText("VARIABLE_NAME"), { target: { value: "ODD_ENCRYPTED" } })
	fireEvent.click(screen.getByRole("button", { name: "Save and apply" }))
	await screen.findByRole("alert")
	expect(mocks.saveEnvironment).not.toHaveBeenCalled()
})
