import { createElement } from "react"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import {
	StreamLogItemKind,
	StreamLogRole,
	type MessageLogItem,
} from "../../../../lib/robozium/view-model"
import { hudVisibilityStore } from "../../../../lib/robozium/hud-visibility"
import { TerminalStream } from "../../../../app/components/terminal/TerminalStream"

describe("TerminalStream", () => {
	afterEach(() => {
		act(() => {
			hudVisibilityStore.setState({
				open: true,
				runActive: false,
				prompting: false,
			})
		})
	})

	it("does not render the terminal prompt after stream starts", () => {
		render(
			createElement(TerminalStream, {
				items: [
					{
						kind: StreamLogItemKind.Message,
						role: StreamLogRole.Agent,
						content: "stream output",
					},
				],
			}),
		)
		expect(document.querySelector('[data-role="agent"]')).not.toBeNull()
		expect(screen.queryByLabelText("Terminal prompt")).toBeNull()
		expect(screen.queryByText("robozium@local")).toBeNull()
	})

	it("skips typewriter reveal for assistant prompt_user messages", () => {
		render(
			createElement(TerminalStream, {
				items: [
					{
						kind: StreamLogItemKind.Message,
						role: StreamLogRole.Agent,
						content:
							'{"action":"prompt_user","rationale":"need your input"}',
						parsed: {
							kind: "assistant",
							action: "prompt_user",
							rationale: "need your input",
							extra: {},
						},
					},
				],
			}),
		)

		expect(document.querySelector(".term-caret--reveal")).toBeNull()
		expect(document.querySelector(".term-reveal-pending")).toBeNull()
		expect(document.querySelector(".intro-emph--fast")).not.toBeNull()
	})

	it("keeps typewriter reveal for non-prompt assistant actions", () => {
		render(
			createElement(TerminalStream, {
				items: [
					{
						kind: StreamLogItemKind.Message,
						role: StreamLogRole.Agent,
						content:
							'{"action":"run_repo_command","rationale":"inspect files"}',
						parsed: {
							kind: "assistant",
							action: "run_repo_command",
							rationale: "inspect files",
							extra: {},
						},
					},
				],
			}),
		)

		expect(document.querySelector(".term-caret--reveal")).not.toBeNull()
		expect(document.querySelector(".term-reveal-pending")).not.toBeNull()
	})

	it("expands and collapses truncated rows only while the HUD is dismissed", () => {
		const rationale = "x".repeat(800)
		const item: MessageLogItem = {
			kind: StreamLogItemKind.Message,
			role: StreamLogRole.Agent,
			content: JSON.stringify({ action: "prompt_user", rationale }),
			parsed: {
				kind: "assistant" as const,
				action: "prompt_user",
				rationale,
				extra: {},
			},
		}
		act(() => {
			hudVisibilityStore.setState({
				open: false,
				runActive: true,
				prompting: false,
			})
		})
		const { rerender } = render(createElement(TerminalStream, { items: [item] }))

		const row = screen.getByRole("button")
		expect(row.classList.contains("term-msg--hoverable")).toBe(true)
		expect(row.getAttribute("aria-expanded")).toBe("false")
		expect(row.textContent).not.toContain(rationale)

		fireEvent.click(row)
		expect(row.getAttribute("aria-expanded")).toBe("true")
		expect(row.textContent).toContain(rationale)

		fireEvent.keyDown(row, { key: " " })
		expect(row.getAttribute("aria-expanded")).toBe("false")
		fireEvent.click(row)
		expect(row.getAttribute("aria-expanded")).toBe("true")

		act(() => hudVisibilityStore.setState({ open: true }))
		rerender(createElement(TerminalStream, { items: [item] }))
		expect(screen.queryByRole("button")).toBeNull()

		act(() => hudVisibilityStore.setState({ open: false }))
		rerender(createElement(TerminalStream, { items: [item] }))
		expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe(
			"false",
		)
	})

	it("does not advertise click affordance for a complete message", () => {
		act(() => {
			hudVisibilityStore.setState({
				open: false,
				runActive: true,
				prompting: false,
			})
		})
		render(
			createElement(TerminalStream, {
				items: [
					{
						kind: StreamLogItemKind.Message,
						role: StreamLogRole.Agent,
						content: "short complete message",
					},
				],
			}),
		)

		const row = document.querySelector(".term-msg")
		expect(row?.classList.contains("term-msg--hoverable")).toBe(false)
		expect(screen.queryByRole("button")).toBeNull()
	})
})
