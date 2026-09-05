import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
vi.mock("@/lib/robosprawl/public-config", () => ({
	HUB_HOME_ARIA_LABEL: "Hub home",
}))
const { showErrorToast } = vi.hoisted(() => ({
	showErrorToast: vi.fn(),
}))
vi.mock("../../../../../app/components/feedback/ErrorToast", () => ({
	showErrorToast,
}))
import { AgentMessagePanel } from "../../../../../app/components/hud/run/AgentMessagePanel"
import { CopyTextButton } from "../../../../../app/components/hud/run/CopyTextButton"

function AgentCopyButton({
	messageId,
	content,
}: {
	messageId: string
	content: string
}) {
	return (
		<CopyTextButton
			copyKey={messageId}
			content={content}
			target="agent output"
		/>
	)
}

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
	showErrorToast.mockReset()
})

describe("AgentMessagePanel", () => {
	it("renders current and historical messages as Markdown", () => {
		const { container, rerender } = render(
			<AgentMessagePanel
				message={{
					id: "message:1",
					content: "**Current**",
					mode: "current",
				}}
			/>,
		)
		expect(container.querySelector("strong")?.textContent).toBe("Current")

		rerender(
			<AgentMessagePanel
				message={{
					id: "message:2",
					content: "_Archived_",
					mode: "history",
				}}
			/>,
		)
		expect(container.querySelector("em")?.textContent).toBe("Archived")
	})

	it("pins streaming content to the bottom and resets non-streaming messages", () => {
		const scrollHeight = Object.getOwnPropertyDescriptor(
			HTMLElement.prototype,
			"scrollHeight",
		)
		Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
			configurable: true,
			get: () => 120,
		})

		try {
			const { container, rerender } = render(
				<AgentMessagePanel
					message={{
						id: "stream:1",
						content: "partial",
						mode: "streaming",
					}}
				/>,
			)
			const scroller = container.querySelector(
				".agent-hud__replyBox-scroll",
			) as HTMLDivElement
			expect(container.querySelector("pre")?.textContent).toBe("partial")
			expect(scroller.scrollTop).toBe(120)

			rerender(
				<AgentMessagePanel
					message={{
						id: "message:1",
						content: "Finished",
						mode: "current",
					}}
				/>,
			)
			expect(scroller.scrollTop).toBe(0)
		} finally {
			if (scrollHeight) {
				Object.defineProperty(
					HTMLElement.prototype,
					"scrollHeight",
					scrollHeight,
				)
			} else {
				Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight")
			}
		}
	})

	it("copies original Markdown during streaming", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined)
		vi.stubGlobal("navigator", { clipboard: { writeText } })
		render(
			<AgentCopyButton
				messageId="stream:1"
				content={"**Partial**\n\n```ts\nconst value = 1\n```"}
			/>,
		)

		const copyButton = screen.getByRole("button", {
			name: "Copy agent output",
		})
		fireEvent.click(copyButton)

		await waitFor(() =>
			expect(writeText).toHaveBeenCalledWith(
				"**Partial**\n\n```ts\nconst value = 1\n```",
			),
		)
		expect(
			screen.getByRole("button", { name: "Agent output copied" }),
		).not.toBeNull()
	})

	it("disables copying when the agent output is empty", () => {
		render(
			<AgentCopyButton messageId="empty" content="" />,
		)

		expect(
			(screen.getByRole("button", {
				name: "Copy agent output",
			}) as HTMLButtonElement).disabled,
		).toBe(true)
	})

	it("reports user-reply clipboard failures with the correct target", async () => {
		vi.stubGlobal("navigator", {
			clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
		})
		render(
			<CopyTextButton
				copyKey="Draft"
				content="Draft"
				target="user reply"
				reverseIcon
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: "Copy user reply" }))

		await waitFor(() =>
			expect(showErrorToast).toHaveBeenCalledWith({
				title: "Copy failed",
				message: "Could not copy the user reply.",
				detail: "Check your browser clipboard permissions and try again.",
			}),
		)
	})

	it("returns to the copy state after the success timeout", async () => {
		vi.useFakeTimers()
		vi.stubGlobal("navigator", {
			clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
		})
		try {
			render(
				<AgentCopyButton messageId="message:1" content="Done" />,
			)

			await act(async () => {
				fireEvent.click(
					screen.getByRole("button", { name: "Copy agent output" }),
				)
				await Promise.resolve()
			})
			expect(
				screen.getByRole("button", { name: "Agent output copied" }),
			).not.toBeNull()
			await act(() => vi.advanceTimersByTimeAsync(2000))
			expect(
				screen.getByRole("button", { name: "Copy agent output" }),
			).not.toBeNull()
		} finally {
			vi.useRealTimers()
		}
	})

	it("shows an error notification when clipboard access fails", async () => {
		vi.stubGlobal("navigator", {
			clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
		})
		render(
			<AgentCopyButton messageId="message:1" content="Done" />,
		)

		fireEvent.click(
			screen.getByRole("button", { name: "Copy agent output" }),
		)

		await waitFor(() =>
			expect(showErrorToast).toHaveBeenCalledWith({
				title: "Copy failed",
				message: "Could not copy the agent output.",
				detail: "Check your browser clipboard permissions and try again.",
			}),
		)
		expect(
			screen.getByRole("button", { name: "Copy agent output" }),
		).not.toBeNull()
	})
})
