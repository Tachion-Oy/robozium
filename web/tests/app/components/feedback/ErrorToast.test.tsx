import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ErrorToastContent } from "../../../../app/components/feedback/ErrorToast"

afterEach(() => cleanup())

describe("ErrorToastContent", () => {
	it("renders the image notice as dismissible information", () => {
		render(<ErrorToastContent
			title="Images omitted"
			message="Your conversation text is still available."
			tone="info" isVisible onDismiss={vi.fn()}
		/>)
		expect(screen.getByText("Images omitted").closest("section")?.classList
			.contains("agent-error-toast--info")).toBe(true)
		expect(screen.getByRole("button", { name: "Dismiss info notification" })).toBeTruthy()
	})

	it("dismisses without propagating pointer events to the HUD backdrop", () => {
		const onDismiss = vi.fn()
		const onDocumentPointerDown = vi.fn()
		document.addEventListener("pointerdown", onDocumentPointerDown)

		render(
			<ErrorToastContent
				message="Run unavailable"
				isVisible
				onDismiss={onDismiss}
			/>,
		)
		const dismiss = screen.getByRole("button", {
			name: "Dismiss error notification",
		})
		expect(dismiss.hasAttribute("data-hud-ignore-dismiss")).toBe(true)
		fireEvent.pointerDown(dismiss)
		fireEvent.click(dismiss)

		expect(onDocumentPointerDown).not.toHaveBeenCalled()
		expect(onDismiss).toHaveBeenCalledTimes(1)
		document.removeEventListener("pointerdown", onDocumentPointerDown)
	})
})
