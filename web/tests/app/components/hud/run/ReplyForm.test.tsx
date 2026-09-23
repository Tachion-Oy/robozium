import { createElement } from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { AgentActivityState } from "../../../../../lib/robozium/session/reducer"
vi.mock("@/lib/robozium/public-config", () => ({
	HUB_HOME_ARIA_LABEL: "Hub home",
}))
import { ReplyForm } from "../../../../../app/components/hud/run/ReplyForm"

type Props = Parameters<typeof ReplyForm>[0]
type Overrides = {
	message?: Partial<Props["message"]>
	composer?: Partial<Props["composer"]>
	navigation?: Partial<Props["navigation"]>
	layoutMode?: Props["layoutMode"]
	controls?: {
		dictation?: Partial<Props["controls"]["dictation"]>
		cancel?: Props["controls"]["cancel"]
		interrupt?: Props["controls"]["interrupt"]
	}
}

function createProps(overrides: Overrides = {}): Props {
	return {
		message: {
			id: "live:passive",
			content: "",
			mode: "current",
			...overrides.message,
		},
		composer: {
			value: "",
			isReplyAvailable: false,
			isSubmitting: false,
			onChange: () => {},
			onSubmit: () => {},
			...overrides.composer,
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
		layoutMode: overrides.layoutMode ?? "top",
		controls: {
			dictation: {
				isRecording: false,
				isTranscribing: false,
				error: null,
				onToggle: () => {},
				...overrides.controls?.dictation,
			},
			cancel: overrides.controls?.cancel,
			interrupt: overrides.controls?.interrupt,
		},
	}
}

function renderForm(overrides: Overrides = {}) {
	return render(createElement(ReplyForm, createProps(overrides)))
}

describe("ReplyForm", () => {
	it("keeps history editable when newer messages are navigable", () => {
		const { container } = renderForm({
			message: { content: "Older prompt", mode: "history" },
			composer: {
				value: "saved draft",
				isReplyAvailable: true,
			},
			navigation: {
				agentActivityState: AgentActivityState.AwaitingInput,
				enabled: {
					first: false,
					previous: false,
					next: true,
					latest: true,
				},
			},
		})

		expect(container.querySelector("form")?.dataset.history).toBe("true")
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(false)
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
			"saved draft",
		)
		expect(
			screen
				.getByRole("button", { name: "Next agent message" })
				.hasAttribute("data-new-message"),
		).toBe(false)
		expect(
			(screen.getByRole("button", { name: "Send" }) as HTMLButtonElement)
				.disabled,
		).toBe(false)
			expect(
				container
					.querySelector(".agent-hud__logo--actions")
					?.getAttribute("data-agent-state"),
			).toBe(AgentActivityState.AwaitingInput)
		expect(container.querySelector("form")?.dataset.agentState).toBe(
			AgentActivityState.AwaitingInput,
		)
	})

	it("keeps the composer available while the agent is working", () => {
		const { container } = renderForm({
			message: { mode: "streaming" },
			navigation: { agentActivityState: AgentActivityState.Working },
		})
		expect(
			(screen.getByRole("textbox") as HTMLTextAreaElement).disabled,
		).toBe(false)
		expect(screen.getByRole("button", { name: "Record" })).not.toBeNull()
		expect(
			(screen.getByRole("button", { name: "Send" }) as HTMLButtonElement)
				.disabled,
		).toBe(true)
		expect(
			container
				.querySelector(".agent-hud__logo--actions")
				?.getAttribute("data-agent-state"),
		).toBe(AgentActivityState.Working)
		expect(container.querySelector(".agent-hud__seam")).toBeNull()
	})

	it("keeps drafting and recording available during other control requests", () => {
		const onToggle = vi.fn()
		renderForm({
			composer: {
				value: "next thought",
				isReplyAvailable: true,
				isSubmitting: true,
			},
			controls: {
				dictation: { onToggle },
				cancel: { isPending: true, onTrigger: () => {} },
				interrupt: { isPending: true, onTrigger: () => {} },
			},
		})

		expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(false)
		fireEvent.click(screen.getByRole("button", { name: "Record" }))
		expect(onToggle).toHaveBeenCalledTimes(1)
		expect(
			(screen.getByRole("button", { name: "Send" }) as HTMLButtonElement)
				.disabled,
		).toBe(true)
	})

	it("allows submit shortcuts when a reply is available", () => {
		const onSubmit = vi.fn()
		renderForm({
			composer: {
				value: "reply",
				isReplyAvailable: true,
				onSubmit,
			},
		})

		fireEvent.keyDown(screen.getByRole("textbox"), {
			key: "Enter",
			shiftKey: false,
		})
		expect(onSubmit).toHaveBeenCalledTimes(1)
	})

	it("copies the exact controlled reply draft from before the Record control", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined)
		vi.stubGlobal("navigator", { clipboard: { writeText } })
		const { container } = renderForm({
			composer: { value: "  transcribed reply\n" },
		})

		fireEvent.click(screen.getByRole("button", { name: "Copy user reply" }))
		await waitFor(() =>
			expect(writeText).toHaveBeenCalledWith("  transcribed reply\n"),
		)
		const controls = Array.from(
			container.querySelectorAll(".agent-hud__actions-submit button"),
		)
		expect(controls[0].getAttribute("aria-label")).toBe("Clear reply")
		expect(controls[1].getAttribute("aria-label")).toBe("User reply copied")
		expect(controls[3].textContent).toBe("Record")
	})

	it("clears the controlled lower-panel reply", () => {
		const onChange = vi.fn()
		renderForm({ composer: { value: "Remove me", onChange } })

		fireEvent.click(screen.getByRole("button", { name: "Clear reply" }))
		expect(onChange).toHaveBeenCalledWith("")
	})

	it("presents dictation errors from the controls model", () => {
		renderForm({
			controls: {
				dictation: { error: "Could not transcribe audio." },
			},
		})

		expect(screen.getByRole("status").textContent).toBe(
			"Could not transcribe audio.",
		)
	})
})
