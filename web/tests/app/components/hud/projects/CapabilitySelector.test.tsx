import { useReducer } from "react"
import { initialHudNavigation, reduceHudNavigation } from "../../../../../lib/robozium/hud-navigation"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { CapabilitySelector } from "../../../../../app/components/hud/projects/CapabilitySelector"
import { listCapabilities } from "../../../../../lib/robozium/client"
import type { CapabilityView } from "../../../../../lib/robozium/wire"

vi.mock("../../../../../lib/robozium/client", () => ({ listCapabilities: vi.fn() }))

const catalog: CapabilityView[] = [
	{ name: "filesystem", kind: "skill", selectable: false, loading: "automatic" },
	{ name: "email", kind: "skill", selectable: true, loading: "on_demand" },
	{ name: "safe_scripts", kind: "tool", selectable: true, loading: null },
]

beforeEach(() => vi.mocked(listCapabilities).mockReset().mockResolvedValue(catalog))
afterEach(cleanup)

function selector(project: string | null = "alpha") {
	const onSubmit = vi.fn()
	const onCancel = vi.fn()
	function Selector({ disabled = false }: { disabled?: boolean }) {
		const [state, dispatch] = useReducer(reduceHudNavigation, {
			...initialHudNavigation(null),
			launch: { project, name: project ?? "", capabilities: {} },
		})
		return <CapabilitySelector draft={state.launch!} disabled={disabled}
			onChange={(change) => dispatch({ type: "launch_changed", change })}
			onCancel={onCancel} onSubmit={() => onSubmit(state.launch!.name.trim(), state.launch!.capabilities)} />
	}
	return { ...render(<Selector />), Selector, onSubmit, onCancel }
}

it("locks included capabilities and submits only selected optional capabilities", async () => {
	const { onSubmit } = selector()
	const fixed = await screen.findByRole("checkbox", { name: /filesystem/ }) as HTMLButtonElement
	expect(fixed.getAttribute("aria-checked")).toBe("true")
	expect(fixed.disabled).toBe(true)
	const email = screen.getByRole("checkbox", { name: /email/ })
	expect(email.getAttribute("aria-checked")).toBe("false")
	fireEvent.click(email)
	fireEvent.click(screen.getByRole("checkbox", { name: /safe scripts/ }))
	fireEvent.click(screen.getByRole("button", { name: "Launch" }))
	// True preserves the skill's declared loading mode on the backend.
	expect(onSubmit).toHaveBeenCalledWith("alpha", { email: true, safe_scripts: true })
	expect(screen.queryByRole("combobox")).toBeNull()
	expect(screen.queryByRole("textbox")).toBeNull()
})

it("requires a new project name and sends an empty explicit selection by default", async () => {
	const { onSubmit } = selector(null)
	await screen.findByRole("checkbox", { name: /email/ })
	expect((screen.getByRole("button", { name: "Launch" }) as HTMLButtonElement).disabled).toBe(true)
	fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "  New Project  " } })
	fireEvent.click(screen.getByRole("button", { name: "Launch" }))
	expect(onSubmit).toHaveBeenCalledWith("New Project", {})
})

it("retries catalog failures and cannot launch before the catalog loads", async () => {
	vi.mocked(listCapabilities).mockRejectedValueOnce(new Error("offline"))
	const { onSubmit } = selector()
	expect((screen.getByRole("button", { name: "Launch" }) as HTMLButtonElement).disabled).toBe(true)
	await screen.findByText("Could not load capabilities.")
	fireEvent.click(screen.getByRole("button", { name: "Retry" }))
	await screen.findByRole("checkbox", { name: /email/ })
	fireEvent.click(screen.getByRole("button", { name: "Launch" }))
	expect(onSubmit).toHaveBeenCalledWith("alpha", {})
})

it("discards selections after unmount and consumes Escape without dismissing the HUD", async () => {
	const first = selector()
	fireEvent.click(await screen.findByRole("checkbox", { name: /email/ }))
	const escape = vi.fn()
	document.addEventListener("keydown", escape)
	try {
		fireEvent.keyDown(screen.getByRole("form"), { key: "Escape" })
		expect(first.onCancel).toHaveBeenCalledOnce()
		expect(escape).not.toHaveBeenCalled()
	} finally {
		document.removeEventListener("keydown", escape)
	}
	first.unmount()
	selector()
	expect((await screen.findByRole("checkbox", { name: /email/ })).getAttribute("aria-checked")).toBe("false")
})

it("disables selection, submission, and cancellation during launch", async () => {
	const { rerender, Selector, onSubmit, onCancel } = selector()
	await screen.findByRole("checkbox", { name: /email/ })
	rerender(<Selector disabled />)
	fireEvent.submit(screen.getByRole("form"))
	fireEvent.keyDown(screen.getByRole("form"), { key: "Escape" })
	expect(onSubmit).not.toHaveBeenCalled()
	expect(onCancel).not.toHaveBeenCalled()
	await waitFor(() => expect((screen.getByRole("checkbox", { name: /email/ }) as HTMLButtonElement).disabled).toBe(true))
})
