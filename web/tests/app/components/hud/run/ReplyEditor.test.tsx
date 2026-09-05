import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ReplyEditor } from "../../../../../app/components/hud/run/ReplyEditor"

describe("ReplyEditor", () => {
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
