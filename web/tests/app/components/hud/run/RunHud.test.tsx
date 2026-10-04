import { useState } from "react"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	createInitialRunSessionState,
	RunHudPhase,
	type HudMessageNavigationDirection,
	type RunSessionState,
} from "../../../../../lib/robozium/session/reducer"
import {
	StreamLogItemKind,
	StreamLogRole,
	type StreamLogItem,
} from "../../../../../lib/robozium/view-model"

const mocks = vi.hoisted(() => ({
	state: null as RunSessionState | null,
	submitReply: vi.fn(),
	navigateHudMessage: vi.fn(),
	cancelRun: vi.fn(),
	interruptRun: vi.fn(),
	rerender: null as (() => void) | null,
}))

vi.mock("../../../../../hooks/useRunSession", () => ({
	useRunSession: () => ({
		submitReply: mocks.submitReply,
		navigateHudMessage: mocks.navigateHudMessage,
		cancelRun: mocks.cancelRun,
		interruptRun: mocks.interruptRun,
	}),
	useRunSessionSelector: (
		selector: (state: RunSessionState) => unknown,
		fallback: unknown,
	) => (mocks.state ? selector(mocks.state) : fallback),
}))

vi.mock("../../../../../hooks/useDictation", () => ({
	useDictation: () => ({
		audioLevel: 0,
		isRecording: false,
		isTranscribing: false,
		toggle: vi.fn(),
	}),
}))

vi.mock("../../../../../app/components/feedback/ErrorToast", () => ({
	showErrorToast: vi.fn(),
}))

import { RunHud } from "../../../../../app/components/hud/run/RunHud"
import { showErrorToast } from "../../../../../app/components/feedback/ErrorToast"

function TestRunHud() {
	const [draft, setDraft] = useState("")

	return (
		<RunHud
			draft={draft}
			onDraftChange={setDraft}
			layoutMode="top"
		/>
	)
}

function promptItem(text: string): StreamLogItem {
	return {
		kind: StreamLogItemKind.Message,
		role: StreamLogRole.Agent,
		content: JSON.stringify({
			action: "prompt_user",
			rationale: "test",
			value: text,
		}),
		parsed: {
			kind: "assistant",
			action: "prompt_user",
			rationale: "test",
			extra: { value: text },
		},
	}
}

function notificationItem(text: string): StreamLogItem {
	return {
		kind: StreamLogItemKind.Message,
		role: StreamLogRole.Agent,
		content: text,
		messageKind: "user_notification",
	}
}

function promptingState(prompts: string[]): RunSessionState {
	const state = createInitialRunSessionState("run-1")
	const current = prompts.at(-1) ?? null
	state.log.items = prompts.map(promptItem)
	state.hud.phase = RunHudPhase.Prompting
	state.hud.prompt = current
	state.hud.promptId = current ? `prompt-${prompts.length}` : null
	state.hud.currentAgentName = "orchestrator"
	state.hud.messages = prompts.map((text, index) => ({
		contentType: "markdown",
		id: `prompt:${index + 1}`,
		text,
		replyId: index === prompts.length - 1 ? state.hud.promptId : null,
	}))
	state.hud.selectedMessageId = state.hud.messages.at(-1)?.id ?? null
	return state
}

function renderHud() {
	const view = render(<TestRunHud />)
	mocks.rerender = () => view.rerender(<TestRunHud />)
	return view
}

beforeEach(() => {
	vi.clearAllMocks()
	mocks.submitReply.mockResolvedValue(true)
	mocks.cancelRun.mockResolvedValue(true)
	mocks.interruptRun.mockResolvedValue(true)
	mocks.navigateHudMessage.mockImplementation(
		(direction: HudMessageNavigationDirection) => {
			if (!mocks.state) return
			const { messages, selectedMessageId } = mocks.state.hud
			const index = messages.findIndex(
				(message) => message.id === selectedMessageId,
			)
			let nextSelectedMessageId = selectedMessageId
			switch (direction) {
				case "first":
					nextSelectedMessageId = messages[0]?.id ?? null
					break
				case "latest": {
					const latestMessage = messages.at(-1)
					nextSelectedMessageId = latestMessage?.replyId
						? latestMessage.id
						: null
					break
				}
				case "previous":
					nextSelectedMessageId =
						index > 0
							? messages[index - 1].id
							: index < 0
								? (messages.at(-1)?.id ?? null)
								: selectedMessageId
					break
				case "next":
					nextSelectedMessageId =
						index >= 0 ? (messages[index + 1]?.id ?? null) : null
					break
			}
			mocks.state.hud.selectedMessageId = nextSelectedMessageId
			mocks.rerender?.()
		},
	)
})

afterEach(() => vi.unstubAllGlobals())

describe("RunHud prompt history", () => {
	it.each([
		{
			name: "streaming",
			buildState: () => {
				const state = createInitialRunSessionState("run-1")
				state.hud.phase = RunHudPhase.Streaming
				state.hud.streaming = {
					contentType: "markdown",
					chunkIndex: 0,
					role: StreamLogRole.Agent,
					messageId: "stream-1",
					text: "Streaming answer",
					agentName: "orchestrator",
				}
				return state
			},
			expected: "Streaming answer",
		},
		{
			name: "current prompt",
			buildState: () => promptingState(["Current prompt"]),
			expected: "Current prompt",
		},
		{
			name: "historical",
			buildState: () => {
				const state = promptingState(["Historical answer", "Current prompt"])
				state.hud.selectedMessageId = state.hud.messages[0].id
				return state
			},
			expected: "Historical answer",
		},
	])("copies the displayed $name message", async ({ buildState, expected }) => {
		const writeText = vi.fn().mockResolvedValue(undefined)
		vi.stubGlobal("navigator", { clipboard: { writeText } })
		mocks.state = buildState()
		renderHud()

		expect(screen.getByText(expected)).not.toBeNull()
		fireEvent.click(screen.getByRole("button", { name: "Copy agent output" }))

		await waitFor(() => expect(writeText).toHaveBeenCalledWith(expected))
	})

	it("shows a live notification, follows its prompt, and keeps history available", () => {
		const notification = "### August timesheet\n\nReady to download."
		const initial = createInitialRunSessionState("run-1")
		initial.hud.currentAgentName = "orchestrator"
		mocks.state = initial
		const view = renderHud()

		const notified = createInitialRunSessionState("run-1")
		notified.log.items = [notificationItem(notification)]
		notified.hud.currentAgentName = "orchestrator"
		notified.hud.messages = [
			{ contentType: "markdown",  id: "notification:1", text: notification, replyId: null },
		]
		notified.hud.selectedMessageId = "notification:1"
		mocks.state = notified
		view.rerender(<TestRunHud />)

		expect(screen.getByText("August timesheet")).not.toBeNull()
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(false)

		mocks.state = promptingState(["Approve these hours?"])
		mocks.state.log.items = [
			notificationItem(notification),
			promptItem("Approve these hours?"),
		]
		mocks.state.hud.messages = [
			{ contentType: "markdown",  id: "notification:1", text: notification, replyId: null },
			...mocks.state.hud.messages,
		]
		view.rerender(<TestRunHud />)

		expect(screen.getByText("Approve these hours?")).not.toBeNull()
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(
			false,
		)
		fireEvent.click(
			screen.getByRole("button", { name: "Previous agent message" }),
		)
		expect(screen.getByText("August timesheet")).not.toBeNull()
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(false)
		expect(
			(screen.getByRole("button", {
				name: "Next agent message",
			}) as HTMLButtonElement).disabled,
		).toBe(false)
	})

	it("restores ordered notifications and renders exact artifact links", () => {
		const state = createInitialRunSessionState("run-restored")
		const report = [
			"Second notification",
			'<file src="readonly/Tachion/acme/Tunnit/timesheet_2026-08.csv">CSV</file>',
			'<file src="readonly/Tachion/acme/Tunnit/timesheet_2026-08.xlsx">XLSX</file>',
			'<file src="readonly/Tachion/acme/Tunnit/timesheet_2026-08.pdf">PDF</file>',
		].join("\n\n")
		state.log.items = [
			notificationItem("First notification"),
			notificationItem(report),
		]
		state.hud.currentAgentName = "orchestrator"
		state.hud.messages = [
			{ contentType: "markdown",  id: "notification:1", text: "First notification", replyId: null },
			{
				contentType: "markdown",
				id: "notification:2",
				text: report,
				replyId: null,
			},
		]
		state.hud.selectedMessageId = "notification:2"
		mocks.state = state
		renderHud()

		expect(screen.getByText("Second notification")).not.toBeNull()
		for (const name of ["CSV", "XLSX", "PDF"]) {
			const link = screen.getByRole("link", { name })
			expect(link.getAttribute("href")).toBe(
				`/api/files/readonly/Tachion/acme/Tunnit/timesheet_2026-08.${name.toLowerCase()}`,
			)
		}
		fireEvent.click(
			screen.getByRole("button", { name: "Previous agent message" }),
		)
		expect(screen.getByText("First notification")).not.toBeNull()
		fireEvent.click(
			screen.getByRole("button", { name: "Next agent message" }),
		)
		expect(screen.getByText("Second notification")).not.toBeNull()
	})

	it("submits the active prompt while an older prompt is displayed", () => {
		mocks.state = promptingState(["First prompt", "Second prompt"])
		renderHud()

		expect(screen.getByText("Second prompt")).not.toBeNull()
		fireEvent.change(screen.getByRole("textbox"), {
			target: { value: "saved draft" },
		})
		fireEvent.click(
			screen.getByRole("button", { name: "Previous agent message" }),
		)

		expect(screen.getByText("First prompt")).not.toBeNull()
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(false)
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
			"saved draft",
		)
		expect(
			(screen.getByRole("button", { name: "Send" }) as HTMLButtonElement)
				.disabled,
		).toBe(false)
		fireEvent.click(screen.getByRole("button", { name: "Send" }))
		expect(mocks.submitReply).toHaveBeenCalledWith("saved draft")

		fireEvent.click(
			screen.getByRole("button", { name: "Jump to latest agent message" }),
		)
		expect(screen.getByText("Second prompt")).not.toBeNull()
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(
			false,
		)
	})

	it("keeps the selected history entry open when a new prompt arrives", () => {
		mocks.state = promptingState(["First prompt", "Second prompt"])
		const view = renderHud()
		fireEvent.click(
			screen.getByRole("button", { name: "Previous agent message" }),
		)
		expect(screen.getByText("First prompt")).not.toBeNull()

		const selectedMessageId = mocks.state.hud.selectedMessageId
		mocks.state = promptingState([
			"First prompt",
			"Second prompt",
			"Third prompt",
		])
		mocks.state.hud.selectedMessageId = selectedMessageId
		view.rerender(<TestRunHud />)

		expect(screen.getByText("First prompt")).not.toBeNull()
		expect(
			screen
				.getByRole("button", { name: "Next agent message" })
				.hasAttribute("data-new-message"),
		).toBe(false)
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(false)

		fireEvent.click(
			screen.getByRole("button", { name: "Next agent message" }),
		)
		expect(screen.getByText("Second prompt")).not.toBeNull()
		fireEvent.click(
			screen.getByRole("button", { name: "Next agent message" }),
		)
		expect(screen.getByText("Third prompt")).not.toBeNull()
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(
			false,
		)
	})

	it("queues a new message while browsing and reaches it through navigation", () => {
		mocks.state = promptingState(["First prompt", "Current prompt"])
		const view = renderHud()
		fireEvent.click(
			screen.getByRole("button", { name: "Previous agent message" }),
		)
		expect(screen.getByText("First prompt")).not.toBeNull()

		const notification = "A fresh notification"
		const selectedMessageId = mocks.state.hud.selectedMessageId
		mocks.state = promptingState(["First prompt", "Current prompt"])
		mocks.state.log.items.push(notificationItem(notification))
		mocks.state.hud.messages.push({
			contentType: "markdown",
			id: "notification:1",
			text: notification,
			replyId: null,
		})
		mocks.state.hud.selectedMessageId = selectedMessageId
		view.rerender(<TestRunHud />)

		expect(screen.getByText("First prompt")).not.toBeNull()
		expect(
			(screen.getByRole("button", {
				name: "Next agent message",
			}) as HTMLButtonElement).disabled,
		).toBe(false)
		fireEvent.click(
			screen.getByRole("button", { name: "Next agent message" }),
		)
		expect(screen.getByText("Current prompt")).not.toBeNull()
		fireEvent.click(
			screen.getByRole("button", { name: "Next agent message" }),
		)
		expect(screen.getByText(notification)).not.toBeNull()
		fireEvent.click(
			screen.getByRole("button", { name: "Next agent message" }),
		)
		expect(screen.getByText("Current prompt")).not.toBeNull()
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(
			false,
		)
	})

	it("allows history browsing while streaming and returns to the live stream", () => {
		const state = promptingState(["First prompt", "Second prompt"])
		state.hud.phase = RunHudPhase.Streaming
		state.hud.prompt = null
		state.hud.promptId = null
		state.hud.streaming = {
			contentType: "markdown",
			chunkIndex: 0,
			role: StreamLogRole.Agent,
			messageId: "stream-1",
			text: '{"action":"working"}',
			agentName: "orchestrator",
		}
		state.hud.messages = state.hud.messages.map((message) => ({
			...message,
			replyId: null,
		}))
		state.hud.selectedMessageId = null
		mocks.state = state
		renderHud()

		expect(screen.getByText("action:working")).not.toBeNull()
		fireEvent.click(
			screen.getByRole("button", { name: "Jump to first agent message" }),
		)
		expect(screen.getByText("First prompt")).not.toBeNull()
		fireEvent.click(
			screen.getByRole("button", { name: "Jump to latest agent message" }),
		)
		expect(screen.getByText("action:working")).not.toBeNull()
	})

	it("reports a failed reply, retains edits made during submission, and allows retry", async () => {
		let rejectSubmission!: (error: Error) => void
		mocks.submitReply.mockReturnValueOnce(new Promise<boolean>((_, reject) => {
			rejectSubmission = reject
		}))
		mocks.state = promptingState(["Current prompt"])
		renderHud()
		const textbox = screen.getByRole("textbox") as HTMLTextAreaElement
		const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement
		fireEvent.change(textbox, { target: { value: "first reply" } })
		fireEvent.click(send)
		expect(send.disabled).toBe(true)
		fireEvent.change(textbox, { target: { value: "edited reply" } })
		await act(async () => rejectSubmission(new Error("offline")))

		expect(showErrorToast).toHaveBeenCalledExactlyOnceWith({
			title: "Reply failed",
			message: "Could not send your reply. Your draft has been kept.",
		})
		expect(textbox.value).toBe("edited reply")
		expect(screen.getByText("Current prompt")).not.toBeNull()
		expect(send.disabled).toBe(false)
		fireEvent.click(send)
		await waitFor(() => expect(textbox.value).toBe(""))
		expect(mocks.submitReply).toHaveBeenLastCalledWith("edited reply")
	})

	it("does not clear draft changes made while submission completes", async () => {
		let resolveSubmission: ((submitted: boolean) => void) | null = null
		mocks.submitReply.mockReturnValueOnce(
			new Promise<boolean>((resolve) => {
				resolveSubmission = resolve
			}),
		)
		mocks.state = promptingState(["Current prompt"])
		renderHud()

		fireEvent.change(screen.getByRole("textbox"), {
			target: { value: "first reply" },
		})
		fireEvent.click(screen.getByRole("button", { name: "Send" }))
		fireEvent.change(screen.getByRole("textbox"), {
			target: { value: "draft for later" },
		})

		await act(async () => resolveSubmission?.(true))
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
			"draft for later",
		)
	})
})
