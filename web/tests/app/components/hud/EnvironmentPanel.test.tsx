import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { EnvironmentPanel } from "@/app/components/hud/environment/EnvironmentPanel"
import type { EnvironmentView } from "@/lib/robozium/wire"

const mocks = vi.hoisted(() => ({ getEnvironment: vi.fn(), saveEnvironment: vi.fn(), resetEnvironment: vi.fn(), importEnvironmentPackage: vi.fn(), showErrorToast: vi.fn(), showNotificationToast: vi.fn() }))
vi.mock("@/lib/robozium/client", () => mocks)
vi.mock("@/app/components/feedback/ErrorToast", () => ({ showErrorToast: mocks.showErrorToast, showNotificationToast: mocks.showNotificationToast }))
const view: EnvironmentView = {
	revision: "first", entries: [], overrides: [], requires_password: false, editable: true,
	suggestions: [
		{ name: "SERVICE_API_KEY", value: "", secret: true, source: "Application" },
		{ name: "ROBOZIUM_WEB_PORT", value: "6969", secret: false, source: "Application" },
	], example_errors: [], imports: [],
}
const defaultPort = { name: "ROBOZIUM_WEB_PORT", value: "6969", secret: false }
const secretView: EnvironmentView = {
	...view, requires_password: true,
	entries: [{ name: "ODD", value: null, secret: true, configured: true, overridden: false, startup: false }],
}
beforeEach(() => {
	vi.resetAllMocks()
	mocks.getEnvironment.mockResolvedValue(view)
	mocks.saveEnvironment.mockResolvedValue({ status: "saved" })
})
afterEach(cleanup)

async function openSuggestion() { fireEvent.click(await screen.findByRole("button", { name: "Change SERVICE_API_KEY" })) }
function apply() { fireEvent.click(screen.getByRole("button", { name: "Apply" })) }
function enterPassword(confirm = false) {
	fireEvent.change(screen.getByLabelText("Encryption password"), { target: { value: "dummy-password" } })
	if (confirm) fireEvent.change(screen.getByLabelText("Confirm encryption password"), { target: { value: "dummy-password" } })
}

it("marks application variables required and saves defaults without opening Change", async () => {
	render(<EnvironmentPanel />)
	await screen.findByRole("button", { name: "Change SERVICE_API_KEY" })
	expect(screen.getByRole("button", { name: "Delete SERVICE_API_KEY" })).toBeTruthy()
	expect(screen.getAllByText("[required]")).toHaveLength(2)
	expect(screen.getByLabelText("Current value for ROBOZIUM_WEB_PORT").textContent).toBe("6969")
	expect(screen.getByLabelText("Current value for ROBOZIUM_WEB_PORT").className).toContain("agent-hud__environment-value")
	expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(false)
	expect(screen.queryByText("Unsaved changes")).toBeNull()
	expect(screen.queryByRole("heading", { name: "Capability folders" })).toBeNull()
	expect(screen.queryByText("local/")).toBeNull()
	expect(screen.getByLabelText("Current value for SERVICE_API_KEY").textContent).toBe("Not set")
	fireEvent.click(screen.getByRole("button", { name: "Save" }))
	await waitFor(() => expect(mocks.saveEnvironment).toHaveBeenCalledWith({
		revision: "first", password: null, entries: [defaultPort],
	}))
})

it("lets the user change a prefilled default before saving", async () => {
	render(<EnvironmentPanel />)
	fireEvent.click(await screen.findByRole("button", { name: "Change ROBOZIUM_WEB_PORT" }))
	expect((screen.getByLabelText("Value for ROBOZIUM_WEB_PORT") as HTMLInputElement).value).toBe("6969")
	fireEvent.change(screen.getByLabelText("Value for ROBOZIUM_WEB_PORT"), { target: { value: "7000" } })
	fireEvent.click(screen.getByRole("button", { name: "Save" }))
	await waitFor(() => expect(mocks.saveEnvironment).toHaveBeenCalledWith({
		revision: "first", password: null, entries: [{ ...defaultPort, value: "7000" }],
	}))
})

it("keeps manual overrides and explicit empty values ahead of example defaults", async () => {
	mocks.getEnvironment.mockResolvedValue({
		...view, overrides: ["ROBOZIUM_WEB_PORT"], entries: [{ name: "HOST", value: "", secret: false }],
		suggestions: [...view.suggestions, { name: "HOST", value: "localhost", secret: false, source: "mail_package" }],
	})
	render(<EnvironmentPanel />)
	await screen.findByRole("button", { name: "Change ROBOZIUM_WEB_PORT" })
	expect(screen.getByLabelText("Current value for ROBOZIUM_WEB_PORT").textContent).toBe("Set in .env")
	expect(screen.getByLabelText("Current value for HOST").textContent).toBe("Empty")
	expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true)
})

it("edits a suggested secret, saves its base name directly, and clears submitted secrets", async () => {
	render(<EnvironmentPanel />)
	await openSuggestion()
	const value = screen.getByLabelText("Value for SERVICE_API_KEY") as HTMLInputElement
	expect(value.type).toBe("password")
	expect(screen.getByRole("checkbox", { name: "Secret" }).getAttribute("aria-checked")).toBe("true")
	expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(false)
	fireEvent.change(value, { target: { value: "dummy-key" } })
	enterPassword(true)
	expect(screen.getByRole("button", { name: "Encrypt and save" }).hasAttribute("disabled")).toBe(false)
	fireEvent.click(screen.getByRole("button", { name: "Encrypt and save" }))
	await waitFor(() => expect(mocks.saveEnvironment).toHaveBeenCalledWith({
		revision: "first", password: "dummy-password", entries: [defaultPort, { name: "SERVICE_API_KEY", value: "dummy-key", secret: true }],
	}))
	await waitFor(() => expect(mocks.showNotificationToast).toHaveBeenCalledWith({
		tone: "success", title: "Settings saved",
		message: "Restart using ./start or start.cmd, keeping --mock for mock mode. Then unlock with Secrets.",
	}))
	expect(mocks.showNotificationToast).toHaveBeenCalledOnce()
	expect(screen.queryByText(/Settings saved|Restart using/)).toBeNull()
	expect(screen.queryByDisplayValue("dummy-password")).toBeNull()
	expect(screen.queryByDisplayValue("dummy-key")).toBeNull()
})

it.each([
	["", "", "Encryption password required", "Enter an encryption password before saving."],
	["dummy-password", "", "Passwords do not match", "Enter the same password in both fields."],
	["dummy-password", "different-password", "Passwords do not match", "Enter the same password in both fields."],
])("shows a toast and preserves edits for invalid passwords (%s, %s)", async (password, confirmation, title, message) => {
	render(<EnvironmentPanel />)
	await openSuggestion()
	fireEvent.change(screen.getByLabelText("Value for SERVICE_API_KEY"), { target: { value: "dummy-key" } })
	fireEvent.change(screen.getByLabelText("Encryption password"), { target: { value: password } })
	fireEvent.change(screen.getByLabelText("Confirm encryption password"), { target: { value: confirmation } })
	fireEvent.click(screen.getByRole("button", { name: "Encrypt and save" }))
	expect(mocks.showErrorToast).toHaveBeenCalledWith({ title, message })
	expect(mocks.saveEnvironment).not.toHaveBeenCalled()
	expect((screen.getByLabelText("Value for SERVICE_API_KEY") as HTMLInputElement).value).toBe("dummy-key")
	expect(screen.queryByRole("alert")).toBeNull()
	enterPassword(true)
	fireEvent.click(screen.getByRole("button", { name: "Encrypt and save" }))
	await waitFor(() => expect(mocks.saveEnvironment).toHaveBeenCalledOnce())
})

it("Add variable opens a blank custom entry", async () => {
	render(<EnvironmentPanel />)
	await screen.findByRole("button", { name: "Change SERVICE_API_KEY" })
	fireEvent.click(screen.getByRole("button", { name: "Add variable" }))
	expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("")
	fireEvent.change(screen.getByLabelText("Name"), { target: { value: "CUSTOM" } })
	fireEvent.change(screen.getByLabelText("Value for CUSTOM"), { target: { value: "custom-value" } })
	apply()
	fireEvent.click(screen.getByRole("button", { name: "Save" }))
	await waitFor(() => expect(mocks.saveEnvironment).toHaveBeenCalledWith({
		revision: "first", password: null, entries: [defaultPort, { name: "CUSTOM", value: "custom-value", secret: false }],
	}))
})

it("disables editing while runs are active", async () => {
	mocks.getEnvironment.mockResolvedValue({ ...view, editable: false })
	render(<EnvironmentPanel />)
	await screen.findByText(/Stop all runs/)
	const button = screen.getByRole("button", { name: "Add variable" }) as HTMLButtonElement
	expect(button.closest("fieldset")?.disabled).toBe(true)
	fireEvent.click(button)
	expect(screen.queryByRole("form", { name: "Variable editor" })).toBeNull()
	expect(mocks.saveEnvironment).not.toHaveBeenCalled()
})

it("shows fixed dots for saved secrets and stages Delete until Save", async () => {
	mocks.getEnvironment.mockResolvedValue(secretView)
	render(<EnvironmentPanel />)
	await screen.findByRole("button", { name: "Change ODD" })
	expect(screen.getByLabelText("Current value for ODD").textContent).toBe("●●●●●●●●")
	fireEvent.click(screen.getByRole("button", { name: "Change ODD" }))
	const input = screen.getByLabelText("Value for ODD") as HTMLInputElement
	expect(input.value).toBe("")
	expect(input.placeholder).toMatch(/unchanged/)
	fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
	fireEvent.click(screen.getByRole("button", { name: "Delete ODD" }))
	expect(screen.queryByRole("button", { name: "Change ODD" })).toBeNull()
	expect(mocks.saveEnvironment).not.toHaveBeenCalled()
	enterPassword()
	fireEvent.click(screen.getByRole("button", { name: "Encrypt and save" }))
	await waitFor(() => expect(mocks.saveEnvironment).toHaveBeenCalledWith({ revision: "first", password: "dummy-password", entries: [defaultPort] }))
})

it("opening, no-op Apply, reverting a value, and Cancel leave Save inactive", async () => {
	const entry = { name: "ROBOZIUM_WEB_PORT", value: "6969", secret: false, configured: true, overridden: false, startup: true }
	mocks.getEnvironment.mockResolvedValue({ ...view, entries: [entry] })
	render(<EnvironmentPanel />)
	fireEvent.click(await screen.findByRole("button", { name: "Change ROBOZIUM_WEB_PORT" }))
	apply()
	expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true)
	fireEvent.click(screen.getByRole("button", { name: "Change ROBOZIUM_WEB_PORT" }))
	fireEvent.change(screen.getByLabelText("Value for ROBOZIUM_WEB_PORT"), { target: { value: "7000" } })
	expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(false)
	fireEvent.change(screen.getByLabelText("Value for ROBOZIUM_WEB_PORT"), { target: { value: "6969" } })
	expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true)
	fireEvent.change(screen.getByLabelText("Value for ROBOZIUM_WEB_PORT"), { target: { value: "7000" } })
	fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
	expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true)
	expect(document.activeElement).toBe(screen.getByRole("button", { name: "Change ROBOZIUM_WEB_PORT" }))
	expect(mocks.saveEnvironment).not.toHaveBeenCalled()
})

it("keeps the encryption password inactive until there are edits to save", async () => {
	mocks.getEnvironment.mockResolvedValue({ ...secretView, entries: [...secretView.entries, defaultPort] })
	render(<EnvironmentPanel />)
	const password = await screen.findByLabelText("Encryption password") as HTMLInputElement
	expect(password.disabled).toBe(true)
	fireEvent.click(screen.getByRole("button", { name: "Change ODD" }))
	expect(password.disabled).toBe(true)
	fireEvent.change(screen.getByLabelText("Value for ODD"), { target: { value: "replacement" } })
	expect(password.disabled).toBe(false)
	fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
	expect(password.disabled).toBe(true)
})

it("requires confirmation to reset without a password, and can cancel", async () => {
	mocks.getEnvironment.mockResolvedValue({ ...secretView, imports: [imported], suggestions })
	mocks.resetEnvironment.mockResolvedValue(undefined)
	render(<EnvironmentPanel />)
	await screen.findByLabelText("Encryption password")
	fireEvent.click(screen.getByRole("button", { name: "Reset environment" }))
	expect(screen.getByText(/Are you sure/)).toBeTruthy()
	expect(mocks.resetEnvironment).not.toHaveBeenCalled()
	fireEvent.click(screen.getByRole("button", { name: "Keep settings" }))
	expect(screen.queryByText(/Are you sure/)).toBeNull()
	expect(mocks.resetEnvironment).not.toHaveBeenCalled()
	fireEvent.click(screen.getByRole("button", { name: "Reset environment" }))
	mocks.getEnvironment.mockResolvedValue({ ...view, imports: [imported], suggestions })
	fireEvent.click(screen.getByRole("button", { name: "Yes, reset" }))
	await waitFor(() => expect(mocks.resetEnvironment).toHaveBeenCalledOnce())
	await waitFor(() => expect(screen.queryByLabelText("Current value for ODD")).toBeNull())
	expect(screen.queryByLabelText("Encryption password")).toBeNull()
	expect(screen.getByText("email")).toBeTruthy()
	expect(mocks.showNotificationToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Environment reset" }))
})

it("reports a failed reset through a toast and preserves settings", async () => {
	mocks.getEnvironment.mockResolvedValue(secretView)
	mocks.resetEnvironment.mockRejectedValue(new Error("Storage is unavailable"))
	render(<EnvironmentPanel />)
	await screen.findByLabelText("Encryption password")
	fireEvent.click(screen.getByRole("button", { name: "Reset environment" }))
	fireEvent.click(screen.getByRole("button", { name: "Yes, reset" }))
	await waitFor(() => expect(mocks.showErrorToast).toHaveBeenCalledWith({ title: "Could not reset settings", message: "Storage is unavailable" }))
	expect(screen.getByLabelText("Current value for ODD")).toBeTruthy()
	expect(mocks.showNotificationToast).not.toHaveBeenCalled()
})

it("allows a confirmed reset when the settings cannot be read", async () => {
	mocks.getEnvironment.mockRejectedValueOnce(new Error("Invalid dotenv assignment"))
	mocks.resetEnvironment.mockResolvedValue(undefined)
	render(<EnvironmentPanel />)
	await waitFor(() => expect(screen.getByRole("button", { name: "Reset environment" }).hasAttribute("disabled")).toBe(false))
	fireEvent.click(screen.getByRole("button", { name: "Reset environment" }))
	fireEvent.click(screen.getByRole("button", { name: "Yes, reset" }))
	await screen.findByRole("button", { name: "Change SERVICE_API_KEY" })
	expect(mocks.resetEnvironment).toHaveBeenCalledOnce()
})

it("validates names before applying and prevents renaming an unreplaced secret", async () => {
	mocks.getEnvironment.mockResolvedValue(secretView)
	render(<EnvironmentPanel />)
	await openSuggestion()
	for (const [name, message] of [
		["ODD_ENCRYPTED", "Use a variable name without the reserved _ENCRYPTED suffix."],
		["ODD", "Variable names must be unique."],
	]) {
		fireEvent.change(screen.getByLabelText("Name"), { target: { value: name } })
		apply()
		expect(mocks.showErrorToast).toHaveBeenLastCalledWith({ title: "Invalid variable", message })
		expect(screen.queryByRole("alert")).toBeNull()
		expect(screen.getByRole("form", { name: "Variable editor" })).toBeTruthy()
	}
	fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
	fireEvent.click(screen.getByRole("button", { name: "Change ODD" }))
	fireEvent.change(screen.getByLabelText("Name"), { target: { value: "RENAMED" } })
	apply()
	expect(mocks.showErrorToast).toHaveBeenLastCalledWith({ title: "Invalid variable", message: "Enter a replacement value to rename a secret." })
	expect(screen.queryByText("Enter a replacement value to rename a secret.")).toBeNull()
	expect(mocks.saveEnvironment).not.toHaveBeenCalled()
})

it("replaces a saved secret", async () => {
	mocks.getEnvironment.mockResolvedValue({ ...secretView, overrides: ["ODD"] })
	render(<EnvironmentPanel />)
	fireEvent.click(await screen.findByRole("button", { name: "Change ODD" }))
	fireEvent.change(screen.getByLabelText("Value for ODD"), { target: { value: "replacement" } })
	apply()
	enterPassword()
	fireEvent.click(screen.getByRole("button", { name: "Encrypt and save" }))
	await waitFor(() => expect(mocks.saveEnvironment).toHaveBeenCalledWith({
		revision: "first", password: "dummy-password", entries: [
			{ name: "ODD", value: "replacement", secret: true },
			defaultPort,
		],
	}))
})

it("validates an open variable before Save and preserves passwords until submission", async () => {
	render(<EnvironmentPanel />)
	await openSuggestion()
	fireEvent.change(screen.getByLabelText("Name"), { target: { value: "INVALID-NAME" } })
	fireEvent.change(screen.getByLabelText("Value for INVALID-NAME"), { target: { value: "dummy-key" } })
	enterPassword(true)
	fireEvent.click(screen.getByRole("button", { name: "Encrypt and save" }))
	expect(mocks.showErrorToast).toHaveBeenCalledWith({ title: "Invalid variable", message: "Use a variable name without the reserved _ENCRYPTED suffix." })
	expect(screen.queryByRole("alert")).toBeNull()
	expect(mocks.saveEnvironment).not.toHaveBeenCalled()
	expect((screen.getByLabelText("Encryption password") as HTMLInputElement).value).toBe("dummy-password")
	fireEvent.change(screen.getByLabelText("Name"), { target: { value: "VALID_NAME" } })
	fireEvent.click(screen.getByRole("button", { name: "Encrypt and save" }))
	await waitFor(() => expect(mocks.saveEnvironment).toHaveBeenCalledWith({
		revision: "first", password: "dummy-password",
		entries: [defaultPort, { name: "VALID_NAME", value: "dummy-key", secret: true }],
	}))
})

it("restores focus to Add variable when the edited row is deleted", async () => {
	mocks.getEnvironment.mockResolvedValue(secretView)
	render(<EnvironmentPanel />)
	fireEvent.click(await screen.findByRole("button", { name: "Change ODD" }))
	fireEvent.click(screen.getByRole("button", { name: "Delete ODD" }))
	expect(screen.queryByRole("form", { name: "Variable editor" })).toBeNull()
	expect(screen.queryByLabelText("Current value for ODD")).toBeNull()
	expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add variable" }))
	expect(mocks.saveEnvironment).not.toHaveBeenCalled()
})

it.each([
	"Settings changed elsewhere. Refresh before saving.",
	"Invalid encrypted secret or password",
])("toasts every failed save without inline errors and preserves edits: %s", async message => {
	mocks.saveEnvironment.mockRejectedValue(new Error(message))
	render(<EnvironmentPanel />)
	await openSuggestion()
	fireEvent.change(screen.getByLabelText("Value for SERVICE_API_KEY"), { target: { value: "dummy-key" } })
	for (let attempt = 1; attempt <= 2; attempt++) {
		enterPassword(true)
		fireEvent.click(screen.getByRole("button", { name: "Encrypt and save" }))
		await waitFor(() => expect(mocks.showErrorToast).toHaveBeenCalledTimes(attempt))
		expect(mocks.showErrorToast).toHaveBeenLastCalledWith({ title: "Could not save settings", message })
		expect(mocks.showNotificationToast).not.toHaveBeenCalled()
		expect(screen.queryByText(message)).toBeNull()
		expect(screen.queryByRole("alert")).toBeNull()
		expect(screen.queryByDisplayValue("dummy-password")).toBeNull()
		expect((screen.getByLabelText("Value for SERVICE_API_KEY") as HTMLInputElement).value).toBe("dummy-key")
	}
})


const imported = {
	name: "mail_package", variables: ["HOST", "SERVICE_PASSWORD"], active: false,
	capabilities: [{ name: "email", kind: "skill" as const, selectable: true, loading: "on_demand" as const }],
}
const suggestions = [
	{ name: "HOST", value: "localhost", secret: false, source: imported.name },
	{ name: "SERVICE_PASSWORD", value: "", secret: true, source: imported.name },
]
const files = [new File(["source"], "__init__.py")]
Object.defineProperty(files[0], "webkitRelativePath", { value: "mail_package/__init__.py" })

async function importFolder() {
	const input = await screen.findByLabelText("Choose tool or skill folder")
	await waitFor(() => expect(input.hasAttribute("disabled")).toBe(false))
	fireEvent.change(input, { target: { files } })
}

it("uploads a folder and confirms its actual capability name and variables before restart", async () => {
	mocks.importEnvironmentPackage.mockResolvedValue({ imported, suggestions })
	render(<EnvironmentPanel />)
	await importFolder()
	await screen.findByText("email")
	expect(screen.getByText("Available on next start")).toBeTruthy()
	expect(screen.getAllByText("[email]")).toHaveLength(2)
	expect(screen.getByLabelText("Current value for HOST").textContent).toBe("localhost")
	expect(screen.getByLabelText("Current value for SERVICE_PASSWORD").textContent).toBe("Not set")
	expect(mocks.importEnvironmentPackage).toHaveBeenCalledWith(files)
	expect(mocks.saveEnvironment).not.toHaveBeenCalled()
	expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(false)
	expect(mocks.showNotificationToast).toHaveBeenCalledWith({ tone: "success", title: "Imported", message: "Skill email found and imported. Available after restart." })
	expect((screen.getByLabelText("Selected tool or skill folder") as HTMLInputElement).value).toBe("")
	fireEvent.click(screen.getByRole("button", { name: "Save" }))
	await waitFor(() => expect(mocks.saveEnvironment).toHaveBeenCalledWith({
		revision: "first", password: null, entries: [defaultPort, { name: "HOST", value: "localhost", secret: false }],
	}))
})

it("preserves draft values and confirms every discovered capability", async () => {
	const capabilities = [...imported.capabilities, { name: "send_mail", kind: "tool", selectable: true, loading: null }]
	mocks.importEnvironmentPackage.mockResolvedValue({ imported: { ...imported, capabilities }, suggestions })
	render(<EnvironmentPanel />)
	fireEvent.click(await screen.findByRole("button", { name: "Add variable" }))
	fireEvent.change(screen.getByLabelText("Name"), { target: { value: "HOST" } })
	fireEvent.change(screen.getByLabelText("Value for HOST"), { target: { value: "my-host" } })
	apply()
	await importFolder()
	await screen.findByText("send mail")
	expect(screen.getByLabelText("Current value for HOST").textContent).toBe("my-host")
	expect(screen.getAllByText("[email, send_mail]")).toHaveLength(2)
	expect(mocks.showNotificationToast).toHaveBeenCalledWith(expect.objectContaining({ message: "Skill email, Tool send_mail found and imported. Available after restart." }))
})

it("shows an import failure without success and retains the folder for retry", async () => {
	mocks.importEnvironmentPackage.mockRejectedValueOnce(new Error("Missing __init__.py"))
	render(<EnvironmentPanel />)
	await importFolder()
	await waitFor(() => expect(mocks.showErrorToast).toHaveBeenCalledWith({ title: "Import failed", message: "Missing __init__.py" }))
	expect(screen.queryByText("Missing __init__.py")).toBeNull()
	expect((screen.getByLabelText("Selected tool or skill folder") as HTMLInputElement).value).toBe("mail_package")
	expect(mocks.showNotificationToast).not.toHaveBeenCalled()
	expect(screen.getByText("No imports yet.")).toBeTruthy()
	mocks.importEnvironmentPackage.mockResolvedValueOnce({ imported, suggestions })
	fireEvent.click(screen.getByRole("button", { name: "Import" }))
	await screen.findByText("email")
	expect(screen.queryByRole("alert")).toBeNull()
})

it("shows load failure and retries with editing disabled until recovery", async () => {
	mocks.getEnvironment.mockRejectedValueOnce(new Error("API is unavailable"))
	mocks.getEnvironment.mockRejectedValueOnce(new Error("API is unavailable"))
	render(<EnvironmentPanel />)
	await waitFor(() => expect(mocks.showErrorToast).toHaveBeenCalledWith({ title: "Could not load settings", message: "API is unavailable" }))
	expect(screen.queryByText("API is unavailable")).toBeNull()
	expect(screen.getByRole("button", { name: "Browse folder" }).hasAttribute("disabled")).toBe(true)
	fireEvent.click(screen.getByRole("button", { name: "Retry" }))
	await waitFor(() => expect(mocks.showErrorToast).toHaveBeenCalledTimes(2))
	fireEvent.click(screen.getByRole("button", { name: "Retry" }))
	await screen.findByRole("button", { name: "Change SERVICE_API_KEY" })
	expect(screen.getByRole("button", { name: "Browse folder" }).hasAttribute("disabled")).toBe(false)
})

it("cancelling the browser picker does not import or report success", async () => {
	render(<EnvironmentPanel />)
	await screen.findByRole("button", { name: "Add variable" })
	fireEvent.change(screen.getByLabelText("Choose tool or skill folder"), { target: { files: [] } })
	expect(mocks.importEnvironmentPackage).not.toHaveBeenCalled()
	expect(mocks.showNotificationToast).not.toHaveBeenCalled()
})

it("reports unreadable environment examples through a toast without inline errors", async () => {
	const errors = ["Could not read the application environment example", "Could not read environment example for mail_package"]
	mocks.getEnvironment.mockResolvedValue({ ...view, example_errors: errors })
	render(<EnvironmentPanel />)
	await screen.findByRole("button", { name: "Change SERVICE_API_KEY" })
	expect(mocks.showErrorToast).toHaveBeenCalledWith({ title: "Could not read environment examples", message: errors.join("\n") })
	for (const error of errors) expect(screen.queryByText(error)).toBeNull()
	expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(false)
})
