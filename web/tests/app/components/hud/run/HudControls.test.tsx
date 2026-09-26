import { createElement } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { AgentActivityState } from "../../../../../lib/robozium/session/reducer"
import { HudControls } from "../../../../../app/components/hud/run/HudControls"

type Props = Parameters<typeof HudControls>[0]
type Overrides = {
	agentMessage?: Props["agentMessage"]
	dictation?: Partial<Props["dictation"]>
	navigation?: Partial<Props["navigation"]>
	submission?: Partial<Props["submission"]>
	replyDraft?: string
	onClearReply?: Props["onClearReply"]
	cancel?: Props["cancel"]
	interrupt?: Props["interrupt"]
}

function createProps(overrides: Overrides = {}): Props {
	return {
		agentMessage: overrides.agentMessage ?? {
			contentType: "markdown",
			id: "agent:current",
			content: "Agent output",
			mode: "current",
		},
		dictation: {
			isRecording: false,
			isTranscribing: false,
			onToggle: () => {},
			...overrides.dictation,
		},
		navigation: {
			agentActivityState: AgentActivityState.Working,
			enabled: {
				first: false,
				previous: false,
				next: false,
				latest: false,
			},
			onNavigate: () => {},
			...overrides.navigation,
		},
		replyDraft: overrides.replyDraft ?? "",
		onClearReply: overrides.onClearReply ?? (() => {}),
		submission: {
			isSubmitting: false,
			canSubmit: true,
			...overrides.submission,
		},
		cancel: overrides.cancel,
		interrupt: overrides.interrupt,
	}
}

function renderControls(overrides: Overrides = {}) {
	return render(createElement(HudControls, createProps(overrides)))
}

describe("HudControls", () => {
	it("disables Send when there is nothing to send", () => {
		renderControls({ submission: { canSubmit: false } })

		expect(
			(screen.getByRole("button", { name: "Send" }) as HTMLButtonElement)
				.disabled,
		).toBe(true)
	})

	it("renders cancel button and calls its action", () => {
		const onTrigger = vi.fn()
		renderControls({ cancel: { isPending: false, onTrigger } })

		fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
		expect(onTrigger).toHaveBeenCalledTimes(1)
	})

	it("shows Cancelling and disables send while cancelling", () => {
		renderControls({
			cancel: { isPending: true, onTrigger: () => {} },
		})
		expect(
			(screen.getByRole("button", { name: "Cancelling..." }) as HTMLButtonElement)
				.disabled,
		).toBe(true)
		expect(
			(screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled,
		).toBe(true)
	})

	it("renders interrupt button and calls its action", () => {
		const onTrigger = vi.fn()
		renderControls({ interrupt: { isPending: false, onTrigger } })

		fireEvent.click(screen.getByRole("button", { name: "Interrupt" }))
		expect(onTrigger).toHaveBeenCalledTimes(1)
	})

	it("shows Interrupting and disables interrupt while interrupting", () => {
		renderControls({
			interrupt: { isPending: true, onTrigger: () => {} },
		})
		expect(
			(
				screen.getByRole("button", { name: "Interrupting..." }) as HTMLButtonElement
			).disabled,
		).toBe(true)
	})

	it("toggles the dictation label and fires the action", () => {
		const onToggle = vi.fn()
		const { rerender } = renderControls({ dictation: { onToggle } })
		const record = screen.getByRole("button", { name: "Record" })

		expect(record.getAttribute("data-dictation-state")).toBe("idle")
		fireEvent.click(record)
		expect(onToggle).toHaveBeenCalledTimes(1)

		rerender(
			createElement(
				HudControls,
				createProps({
					dictation: { isRecording: true, onToggle },
				}),
			),
		)
		expect(
			screen
				.getByRole("button", { name: "Stop" })
				.getAttribute("data-dictation-state"),
		).toBe("recording")
	})

	it("shows the audio-level meter while recording", () => {
		const { container } = renderControls({
			dictation: { isRecording: true, audioLevel: 0.5 },
		})

		expect(screen.getByRole("button", { name: "Stop" })).not.toBeNull()
		expect(container.querySelector(".agent-hud__dictate-meter")).not.toBeNull()
	})

	it("disables the dictation button while transcribing", () => {
		renderControls({ dictation: { isTranscribing: true } })

		const transcribing = screen.getByRole("button", {
			name: "Transcribing voice input",
		}) as HTMLButtonElement
		expect(transcribing.disabled).toBe(true)
		expect(transcribing.textContent).toBe("Text…")
		expect(transcribing.getAttribute("data-dictation-state")).toBe(
			"transcribing",
		)
	})

	it("keeps every control visible while the agent is working", () => {
		renderControls({
			cancel: { isPending: false, onTrigger: vi.fn() },
			interrupt: { isPending: false, onTrigger: vi.fn() },
		})

		expect(screen.getByRole("button", { name: "Record" })).not.toBeNull()
		expect(screen.getByRole("button", { name: "Send" })).not.toBeNull()
		expect(screen.getByRole("button", { name: "Cancel" })).not.toBeNull()
		expect(screen.getByRole("button", { name: "Interrupt" })).not.toBeNull()
	})

	it("keeps Record active while a reply submission is in flight", () => {
		const onToggle = vi.fn()
		renderControls({
			submission: { isSubmitting: true },
			dictation: { onToggle },
		})

		fireEvent.click(screen.getByRole("button", { name: "Record" }))
		expect(onToggle).toHaveBeenCalledTimes(1)
		expect(
			(screen.getByRole("button", { name: "Send" }) as HTMLButtonElement)
				.disabled,
		).toBe(true)
	})

	it("renders clear and both copy controls before Record and Send", () => {
		const { container } = renderControls({ replyDraft: "Draft" })
		const submitCluster = container.querySelector(".agent-hud__actions-submit")
		expect(submitCluster).not.toBeNull()
		expect(
			Array.from(submitCluster?.querySelectorAll("button") ?? []).map(
				(button) => button.getAttribute("aria-label") ?? button.textContent,
			),
		).toEqual([
			"Clear reply",
			"Copy user reply",
			"Copy agent output",
			"Record",
			"Send",
		])
		expect(
			container.querySelector(".agent-hud__message-nav")?.parentElement,
		).toBe(container.querySelector(".agent-hud__actions"))
		expect(
			container.querySelector(".agent-hud__logo--actions"),
		).not.toBeNull()
	})

	it("clears only when the reply contains text", () => {
		const onClearReply = vi.fn()
		const { rerender } = renderControls({ onClearReply })
		const clear = () =>
			screen.getByRole("button", { name: "Clear reply" }) as HTMLButtonElement

		expect(clear().disabled).toBe(true)
		rerender(
			createElement(
				HudControls,
				createProps({ replyDraft: "Draft", onClearReply }),
			),
		)
		fireEvent.click(clear())
		expect(onClearReply).toHaveBeenCalledTimes(1)
	})
})
