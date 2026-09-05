import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ErrorToastContent } from "../../../../app/components/feedback/ErrorToast"

afterEach(() => cleanup())

describe("ErrorToastContent", () => {
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
