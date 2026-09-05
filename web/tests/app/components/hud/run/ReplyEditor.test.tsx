import { createEvent, fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ReplyEditor } from "../../../../../app/components/hud/run/ReplyEditor"

describe("ReplyEditor", () => {
	it.each([
		// key, canSubmit, isComposing, shiftKey, prevented, submissions
		["Enter", true, true, false, false, 0],
		["Enter", false, true, false, false, 0],
		["Enter", true, false, false, true, 1],
		["Enter", false, false, false, true, 0],
		["Enter", true, false, true, false, 0],
		["Enter", false, false, true, false, 0],
		["a", true, false, false, false, 0],
	] as const)("handles %s (canSubmit=%s, composing=%s, shift=%s)", (key, canSubmit, isComposing, shiftKey, prevented, submissions) => {
		const onSubmit = vi.fn()
		render(
			<form onSubmit={(event) => {
				event.preventDefault()
				onSubmit()
			}}>
				<ReplyEditor value="draft" canSubmit={canSubmit} onChange={vi.fn()} />
			</form>,
		)
		const textarea = screen.getByRole("textbox")
		const event = createEvent.keyDown(textarea, { key, isComposing, shiftKey })
		fireEvent(textarea, event)
		expect(event.defaultPrevented).toBe(prevented)
		expect(onSubmit).toHaveBeenCalledTimes(submissions)
		expect((textarea as HTMLTextAreaElement).value).toBe("draft")
	})

	it("scrolls externally inserted text into view without following local edits", () => {
		const scrollHeight = Object.getOwnPropertyDescriptor(
			HTMLTextAreaElement.prototype,
			"scrollHeight",
		)
		Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
			configurable: true,
			get: () => 120,
		})

		try {
			const onChange = vi.fn()
			const { rerender } = render(
				<ReplyEditor
					value="draft"
					canSubmit
					onChange={onChange}
				/>,
			)
			const textarea = screen.getByRole("textbox") as HTMLTextAreaElement
			textarea.scrollTop = 15

			fireEvent.change(textarea, { target: { value: "local edit" } })
			rerender(
				<ReplyEditor
					value="local edit"
					canSubmit
					onChange={onChange}
				/>,
			)
			expect(textarea.scrollTop).toBe(15)

			rerender(
				<ReplyEditor
					value="local edit dictated text"
					canSubmit
					onChange={onChange}
				/>,
			)
			expect(textarea.scrollTop).toBe(120)
		} finally {
			if (scrollHeight) {
				Object.defineProperty(
					HTMLTextAreaElement.prototype,
					"scrollHeight",
					scrollHeight,
				)
			} else {
				Reflect.deleteProperty(
					HTMLTextAreaElement.prototype,
					"scrollHeight",
				)
			}
		}
	})
})
