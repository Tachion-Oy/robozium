import { WireLifecycleStatus } from "@/lib/robosprawl/wire"
import { describe, expect, it } from "vitest"
import {
	createInitialRunSessionState,
	hasPermanentRunFailure,
	reduceRunSessionState,
	RunHudPhase,
	shouldExitRunView,
} from "../../../../lib/robosprawl/session/reducer"
import { PipeEventType, RunLifecycleKind, WireRole } from "../../../../lib/robosprawl/wire"

function reduce(
	events: Parameters<typeof reduceRunSessionState>[1][],
	runId = "run-1",
) {
	return events.reduce(
		(state, event) => reduceRunSessionState(state, event),
		createInitialRunSessionState(runId),
	)
}

describe("run session reducer", () => {
	it("restores a tagged notification from the initial run trace", () => {
		const state = reduce([
			{
				class: "runView",
				type: "received",
				source: "initial",
				runView: {
					project: "alpha",
					status: "running",
					current_agent_name: "root",
					parent_agent_name: null,
					message_trace: [
						{
							type: PipeEventType.Message,
							sequence: 4,
							payload: {
								role: WireRole.Assistant,
								content: "### Restored report",
								truncation: {},
								message_kind: "user_notification",
							},
						},
					],
					current_prompt_id: null,
					current_prompt: null,
					error: null,
				},
			},
		])

		expect(state.log.items).toEqual([
			{
				kind: "message",
				role: "agent",
				content: "### Restored report",
				hudText: "### Restored report",
				messageKind: "user_notification",
			},
		])
		expect(state.hud.messages).toEqual([
			{ id: "log:0", text: "### Restored report", replyId: null },
		])
		expect(state.hud.selectedMessageId).toBe("log:0")
	})

	it("reuses an unchanged HUD message timeline across polls", () => {
		const state = reduce([
			{
				class: "stream",
				type: "frame_received",
				receivedAt: "2026-08-14T12:00:00.000Z",
				frame: {
					type: PipeEventType.Message,
					sequence: 1,
					payload: {
						role: WireRole.Assistant,
						content: "Report ready",
						truncation: {},
						message_kind: "user_notification",
					},
				},
			},
		])

		const polled = reduceRunSessionState(state, {
			class: "runView",
			type: "received",
			source: "poll",
			runView: {
				project: "alpha",
				status: "running",
				current_agent_name: "root",
				parent_agent_name: null,
				message_trace: [],
				current_prompt_id: null,
				current_prompt: null,
				error: null,
			},
		})

		expect(polled.hud.messages).toBe(state.hud.messages)
	})

	it("keeps the HUD message timeline through non-HUD stream traffic", () => {
		const state = reduce([
			{
				class: "stream",
				type: "frame_received",
				receivedAt: "2026-08-14T12:00:00.000Z",
				frame: {
					type: PipeEventType.Message,
					sequence: 1,
					payload: {
						role: WireRole.Assistant,
						content: "Report ready",
						truncation: {},
						message_kind: "user_notification",
					},
				},
			},
		])

		const afterToolMessage = reduceRunSessionState(state, {
			class: "stream",
			type: "frame_received",
			receivedAt: "2026-08-14T12:00:01.000Z",
			frame: {
				type: PipeEventType.Message,
				sequence: 2,
				payload: {
					role: WireRole.Assistant,
					content: JSON.stringify({
						action: "run_repo_command",
						rationale: "Inspect the workspace",
						command: "git status --short",
					}),
					truncation: {},
				},
			},
		})
		expect(afterToolMessage.hud.messages).toBe(state.hud.messages)

		const afterTelemetry = reduceRunSessionState(afterToolMessage, {
			class: "stream",
			type: "frame_received",
			receivedAt: "2026-08-14T12:00:02.000Z",
			frame: {
				type: PipeEventType.RuntimeEvent,
				sequence: 3,
				payload: {
					category: "tool",
					kind: "succeeded",
					level: "info",
					message: "tool completed",
					agent_name: "root",
					data: { tool: "run_repo_command" },
				},
			},
		})
		expect(afterTelemetry.hud.messages).toBe(state.hud.messages)
	})

	it("queues every atomic HUD message and follows the newest one", () => {
		const promptContent = JSON.stringify({
			action: "prompt_user",
			rationale: "Need confirmation",
			value: "Approve these hours?",
		})
		let state = reduce([
			{
				class: "stream",
				type: "frame_received",
				receivedAt: "2026-08-14T12:00:00.000Z",
				frame: {
					type: PipeEventType.Message,
					sequence: 1,
					payload: {
						role: WireRole.Assistant,
						content: "Report ready",
						truncation: {},
						message_kind: "user_notification",
					},
				},
			},
			{
				class: "stream",
				type: "frame_received",
				receivedAt: "2026-08-14T12:00:01.000Z",
				frame: {
					type: PipeEventType.Message,
					sequence: 2,
					payload: {
						role: WireRole.Assistant,
						content: promptContent,
						truncation: {},
					},
				},
			},
			{
				class: "runView",
				type: "received",
				source: "poll",
				runView: {
					project: "alpha",
					status: "awaiting_user_input",
					current_agent_name: "root",
					parent_agent_name: null,
					message_trace: [],
					current_prompt_id: "p-1",
					current_prompt: "Approve these hours?",
					error: null,
				},
			},
		])

		expect(state.hud.messages).toEqual([
			{ id: "log:0", text: "Report ready", replyId: null },
			{ id: "log:1", text: "Approve these hours?", replyId: "p-1" },
		])
		expect(state.hud.selectedMessageId).toBe("log:1")
		expect(state.hud.isMessageHistoryPinned).toBe(false)

		state = reduceRunSessionState(state, {
			class: "control",
			type: "hud_message_navigated",
			direction: "previous",
		})
		expect(state.hud.selectedMessageId).toBe("log:0")
		expect(state.hud.isMessageHistoryPinned).toBe(true)
	})

	it("pins deliberately selected history until navigation returns to live", () => {
		const notification = (sequence: number, content: string) => ({
			class: "stream" as const,
			type: "frame_received" as const,
			receivedAt: `2026-08-14T12:00:0${sequence}.000Z`,
			frame: {
				type: PipeEventType.Message as const,
				sequence,
				payload: {
					role: WireRole.Assistant,
					content,
					truncation: {},
					message_kind: "user_notification",
				},
			},
		})

		let state = reduce([
			notification(1, "First"),
			notification(2, "Second"),
		])
		expect(state.hud.selectedMessageId).toBe("log:1")

		state = reduceRunSessionState(state, {
			class: "control",
			type: "hud_message_navigated",
			direction: "previous",
		})
		expect(state.hud.selectedMessageId).toBe("log:0")
		expect(state.hud.isMessageHistoryPinned).toBe(true)

		state = reduceRunSessionState(state, notification(3, "Third"))
		expect(state.hud.messages.map((message) => message.text)).toEqual([
			"First",
			"Second",
			"Third",
		])
		expect(state.hud.selectedMessageId).toBe("log:0")
		expect(state.hud.isMessageHistoryPinned).toBe(true)

		for (const expectedId of ["log:1", "log:2", null]) {
			state = reduceRunSessionState(state, {
				class: "control",
				type: "hud_message_navigated",
				direction: "next",
			})
			expect(state.hud.selectedMessageId).toBe(expectedId)
		}
		expect(state.hud.isMessageHistoryPinned).toBe(false)

		state = reduceRunSessionState(state, notification(4, "Fourth"))
		expect(state.hud.selectedMessageId).toBe("log:3")
		expect(state.hud.isMessageHistoryPinned).toBe(false)
	})

	it("jumps to the first message and the latest live or prompt endpoint", () => {
		let state = createInitialRunSessionState("run-jumps")
		state.hud.messages = [
			{ id: "message-1", text: "First", replyId: null },
			{ id: "message-2", text: "Second", replyId: null },
		]
		state.hud.selectedMessageId = null

		state = reduceRunSessionState(state, {
			class: "control",
			type: "hud_message_navigated",
			direction: "first",
		})
		expect(state.hud.selectedMessageId).toBe("message-1")
		expect(state.hud.isMessageHistoryPinned).toBe(true)

		state = reduceRunSessionState(state, {
			class: "control",
			type: "hud_message_navigated",
			direction: "latest",
		})
		expect(state.hud.selectedMessageId).toBeNull()
		expect(state.hud.isMessageHistoryPinned).toBe(false)

		state.hud.messages = [
			...state.hud.messages,
			{ id: "prompt-3", text: "Current prompt", replyId: "prompt-3" },
		]
		state.hud.promptId = "prompt-3"
		state.hud.selectedMessageId = "message-1"
		state.hud.isMessageHistoryPinned = true

		state = reduceRunSessionState(state, {
			class: "control",
			type: "hud_message_navigated",
			direction: "latest",
		})
		expect(state.hud.selectedMessageId).toBe("prompt-3")
		expect(state.hud.isMessageHistoryPinned).toBe(false)
	})

	it("keeps endpoint jumps inert when message history is empty", () => {
		let state = createInitialRunSessionState("run-empty-jumps")

		for (const direction of ["first", "latest"] as const) {
			state = reduceRunSessionState(state, {
				class: "control",
				type: "hud_message_navigated",
				direction,
			})
			expect(state.hud.selectedMessageId).toBeNull()
			expect(state.hud.isMessageHistoryPinned).toBe(false)
		}
	})

	it("shows a new live stream unless message history is pinned", () => {
		let state = reduce([
			{
				class: "stream",
				type: "frame_received",
				receivedAt: "2026-08-14T12:00:00.000Z",
				frame: {
					type: PipeEventType.Message,
					sequence: 1,
					payload: {
						role: WireRole.Assistant,
						content: "Completed notification",
						truncation: {},
						message_kind: "user_notification",
					},
				},
			},
		])

		state = reduceRunSessionState(state, {
			class: "stream",
			type: "frame_received",
			receivedAt: "2026-08-14T12:00:01.000Z",
			frame: {
				type: PipeEventType.MessageDelta,
				sequence: 2,
				payload: {
					message_id: "m-2",
					delta: "Newest live output",
					chunk_index: 0,
					role: WireRole.Assistant,
					agent_name: "root",
					sequence: 2,
				},
			},
		})
		expect(state.hud.selectedMessageId).toBeNull()
		expect(state.hud.phase).toBe(RunHudPhase.Streaming)

		state = reduceRunSessionState(state, {
			class: "control",
			type: "hud_message_navigated",
			direction: "previous",
		})
		expect(state.hud.selectedMessageId).toBe("log:0")
		expect(state.hud.isMessageHistoryPinned).toBe(true)

		state = reduceRunSessionState(state, {
			class: "stream",
			type: "frame_received",
			receivedAt: "2026-08-14T12:00:02.000Z",
			frame: {
				type: PipeEventType.MessageDelta,
				sequence: 3,
				payload: {
					message_id: "m-2",
					delta: " continues",
					chunk_index: 1,
					role: WireRole.Assistant,
					agent_name: "root",
					sequence: 3,
				},
			},
		})
		expect(state.hud.selectedMessageId).toBe("log:0")
		expect(state.hud.isMessageHistoryPinned).toBe(true)
	})

	it("hydrates snapshot state and enters prompting phase when prompt exists", () => {
		const state = reduce([
			{
				class: "runView",
				type: "received",
				source: "initial",
				minSequence: 3,
				runView: {
					project: "alpha",
					status: "awaiting_user_input",
					current_agent_name: "root",
					parent_agent_name: null,
					message_trace: [],
					current_prompt_id: "p-1",
					current_prompt: "Need confirmation",
					error: null,
				},
			},
		])

		expect(state.log.minSequence).toBe(3)
		expect(state.projectSlug).toBe("alpha")
		expect(state.hud.promptId).toBe("p-1")
		expect(state.hud.phase).toBe(RunHudPhase.Prompting)
	})

	it("closes in-flight stream by message_id and keeps settled text until prompt arrives", () => {
		const state = reduce([
			{
				class: "stream",
				type: "frame_received",
				receivedAt: "2026-07-02T12:00:00.000Z",
				frame: {
					type: PipeEventType.MessageDelta,
					sequence: 4,
					payload: {
						message_id: "m-1",
						delta: "Hello",
						chunk_index: 0,
						role: WireRole.Assistant,
						agent_name: "root",
						sequence: 4,
					},
				},
			},
			{
				class: "stream",
				type: "frame_received",
				receivedAt: "2026-07-02T12:00:01.000Z",
				frame: {
					type: PipeEventType.Message,
					sequence: 5,
					message_id: "m-1",
					payload: {
						role: WireRole.Assistant,
						content: '{"action":"run_repo_command","rationale":"scan"}',
						truncation: {},
					},
				},
			},
			{
				class: "runView",
				type: "received",
				source: "poll",
				runView: {
					project: "alpha",
					status: "awaiting_user_input",
					current_agent_name: "root",
					parent_agent_name: null,
					message_trace: [],
					current_prompt_id: null,
					current_prompt: null,
					error: null,
				},
			},
			{
				class: "runView",
				type: "received",
				source: "poll",
				runView: {
					project: "alpha",
					status: "awaiting_user_input",
					current_agent_name: "root",
					parent_agent_name: null,
					message_trace: [],
					current_prompt_id: "p-1",
					current_prompt: "Need confirmation",
					error: null,
				},
			},
		])

		expect(state.hud.lastStreaming?.text).toBe("Hello")
		expect(state.hud.promptId).toBe("p-1")
		expect(state.hud.phase).toBe(RunHudPhase.Prompting)
	})

	it("finalizes streamed tool output as one HUD message before a separate final result", () => {
		const state = reduce([
			{
				class: "stream",
				type: "frame_received",
				receivedAt: "2026-08-24T12:00:00.000Z",
				frame: {
					type: PipeEventType.MessageDelta,
					sequence: 1,
					payload: {
						message_id: "codex-progress",
						delta: "[codex] preparing",
						chunk_index: 1,
						role: WireRole.Assistant,
						agent_name: "orchestrator",
						sequence: 1,
					},
				},
			},
			{
				class: "stream",
				type: "frame_received",
				receivedAt: "2026-08-24T12:00:01.000Z",
				frame: {
					type: PipeEventType.MessageDelta,
					sequence: 2,
					payload: {
						message_id: "codex-progress",
						delta: "\n[codex] command completed",
						chunk_index: 2,
						role: WireRole.Assistant,
						agent_name: "orchestrator",
						sequence: 2,
					},
				},
			},
			{
				class: "stream",
				type: "frame_received",
				receivedAt: "2026-08-24T12:00:02.000Z",
				frame: {
					type: PipeEventType.Message,
					sequence: 3,
					message_id: "codex-progress",
					payload: {
						role: WireRole.Assistant,
						content: "[codex] preparing\n[codex] command completed",
						truncation: {},
						message_kind: "user_notification",
					},
				},
			},
			{
				class: "stream",
				type: "frame_received",
				receivedAt: "2026-08-24T12:00:03.000Z",
				frame: {
					type: PipeEventType.Message,
					sequence: 4,
					payload: {
						role: WireRole.Assistant,
						content: "Implemented the change.",
						truncation: {},
						message_kind: "user_notification",
					},
				},
			},
		])

		expect(state.hud.streaming).toBeNull()
		expect(state.hud.messages).toEqual([
			{
				id: "log:0",
				text: "[codex] preparing\n[codex] command completed",
				replyId: null,
			},
			{
				id: "log:1",
				text: "Implemented the change.",
				replyId: null,
			},
		])
		expect(state.hud.selectedMessageId).toBe("log:1")
	})

	it("silently clears abandoned partial output when an LLM call retries", () => {
		const state = reduce([
			{
				class: "stream",
				type: "frame_received",
				receivedAt: "2026-07-02T12:00:00.000Z",
				frame: {
					type: PipeEventType.MessageDelta,
					sequence: 4,
					payload: {
						message_id: "m-1",
						delta: "partial",
						chunk_index: 1,
						role: WireRole.Assistant,
						agent_name: "root",
						sequence: 4,
					},
				},
			},
			{
				class: "stream",
				type: "frame_received",
				receivedAt: "2026-07-02T12:00:01.000Z",
				frame: {
					type: PipeEventType.RuntimeEvent,
					sequence: 5,
					payload: {
						category: "llm",
						kind: "retrying",
						level: "info",
						message: "LLM call retrying",
						agent_name: "root",
						data: { attempt: 2, max_attempts: 3 },
					},
				},
			},
		])

		expect(state.hud.streaming).toBeNull()
		expect(state.hud.lastStreaming).toBeNull()
		expect(state.hud.phase).toBe(RunHudPhase.Passive)
		expect(state.log.items).toEqual([])
		expect(state.notifications).toEqual([])
	})

	it("collects runtime error notifications without adding log rows", () => {
		const state = reduce([
			{
				class: "stream",
				type: "frame_received",
				receivedAt: "2026-07-02T12:00:00.000Z",
				frame: {
					type: PipeEventType.RuntimeEvent,
					sequence: 6,
					payload: {
						category: "tool",
						kind: "timeout",
						level: "error",
						message: "tool timed out",
						agent_name: "root",
						data: { seconds: 10 },
					},
				},
			},
		])

		expect(state.log.items).toEqual([])
		expect(state.notifications).toEqual([
			{
				id: "run-1:6",
				category: "tool",
				kind: "timeout",
				level: "error",
				message: "tool timed out",
				agentName: "root",
				data: { seconds: 10 },
			},
		])
	})

	it("shows stream transport failures in both log and notifications", () => {
		const state = reduce([
			{
				class: "stream",
				type: "open_failed",
				message: "stream request failed (503)",
			},
		])

		expect(state.log.items).toEqual([
			{
				kind: "message",
				role: "error",
				content: "stream request failed (503)",
			},
		])
		expect(state.notifications).toEqual([
			{
				id: "run-1:stream:open_failed:stream request failed (503)",
				category: "stream",
				kind: "open_failed",
				level: "error",
				message: "stream request failed (503)",
				agentName: "system",
				data: null,
			},
		])
		expect(hasPermanentRunFailure(state)).toBe(true)
		expect(shouldExitRunView(state)).toBe(true)
	})

	it("does not treat retryable diagnostics or runtime errors as a permanent run failure", () => {
		const state = reduce([
			{
				class: "stream",
				type: "frame_received",
				receivedAt: "2026-08-16T12:00:00.000Z",
				frame: {
					type: PipeEventType.RuntimeEvent,
					sequence: 1,
					payload: {
						category: "stream",
						kind: "open_failed",
						level: "error",
						message: "agent-level diagnostic",
						agent_name: "orchestrator",
					},
				},
			},
		])

		expect(hasPermanentRunFailure(state)).toBe(false)
		expect(shouldExitRunView(state)).toBe(false)
	})

	it("preserves error_kind data on llm runtime error notifications", () => {
		const state = reduce([
			{
				class: "stream",
				type: "frame_received",
				receivedAt: "2026-07-02T12:00:00.000Z",
				frame: {
					type: PipeEventType.RuntimeEvent,
					sequence: 6,
					payload: {
						category: "llm",
						kind: "failed",
						level: "error",
						message: "401 invalid api key",
						agent_name: "root",
						data: { error_kind: "auth", endpoint: "openrouter", model: "gpt-x" },
					},
				},
			},
		])

		expect(state.notifications[0].data).toEqual({
			error_kind: "auth",
			endpoint: "openrouter",
			model: "gpt-x",
		})
	})

	it("collects warning runtime events as nonfatal notifications", () => {
		const state = reduce([
			{
				class: "stream",
				type: "frame_received",
				receivedAt: "2026-07-02T12:00:00.000Z",
				frame: {
					type: PipeEventType.RuntimeEvent,
					sequence: 7,
					payload: {
						category: "llm",
						kind: "failed",
						level: "warning",
						message: "402 insufficient credits",
						agent_name: "root",
						data: { error_kind: "insufficient_funds" },
					},
				},
			},
		])

		expect(state.notifications[0]).toMatchObject({
			id: "run-1:7",
			category: "llm",
			level: "warning",
			data: { error_kind: "insufficient_funds" },
		})
	})

	it("enters done phase on terminal status", () => {
		const state = reduce([
			{
				class: "stream",
				type: "frame_received",
				receivedAt: "2026-07-02T12:00:00.000Z",
				frame: {
					type: PipeEventType.RunLifecycle,
					payload: {
						kind: RunLifecycleKind.Stopped,
						agent_name: "root",
						sequence: 11,
						status: WireLifecycleStatus.Completed,
					},
				},
			},
		])

		expect(state.hud.status).toBe("completed")
		expect(state.hud.phase).toBe(RunHudPhase.Done)
		expect(shouldExitRunView(state)).toBe(true)
	})

	it("does not treat a child agent stopping as root run completion", () => {
		const state = reduce([
			{
				class: "stream",
				type: "frame_received",
				receivedAt: "2026-07-02T12:00:00.000Z",
				frame: {
					type: PipeEventType.RunLifecycle,
					payload: {
						kind: RunLifecycleKind.Stopped,
						agent_name: "specialist",
						parent_agent_name: "root",
						sequence: 11,
						status: WireLifecycleStatus.Completed,
					},
				},
			},
		])

		expect(state.hud.status).toBeNull()
		expect(state.hud.phase).toBe(RunHudPhase.Passive)
		expect(shouldExitRunView(state)).toBe(false)
	})

	it.each(["cancelled", "completed", "failed"] as const)(
		"enters done phase from a poll snapshot reporting terminal status %s, even mid-cancel",
		(status) => {
			const state = reduce([
				{ class: "control", type: "cancel_requested" },
				{
					class: "runView",
					type: "received",
					source: "poll",
					runView: {
						project: "alpha",
						status,
						current_agent_name: "root",
						parent_agent_name: null,
						message_trace: [],
						current_prompt_id: null,
						current_prompt: null,
						error: null,
					},
				},
			])

			// A terminal poll snapshot must win over any stale local "cancelling"
			// flag: the HUD unmounts (phase "done") instead of showing a disabled
			// "Cancelling..." button forever.
			expect(state.hud.status).toBe(status)
			expect(state.hud.phase).toBe(RunHudPhase.Done)
		},
	)

	it("never leaves isCancelling true once the server reports a terminal status", () => {
		const nonInteractiveStatuses = [
			"cancelled",
			"completed",
			"failed",
		] as const
		for (const status of nonInteractiveStatuses) {
			const state = reduce([
				{ class: "control", type: "cancel_requested" },
				{
					class: "runView",
					type: "received",
					source: "poll",
					runView: {
						project: "alpha",
						status,
						current_agent_name: "root",
						parent_agent_name: null,
						message_trace: [],
						current_prompt_id: null,
						current_prompt: null,
						error: null,
					},
				},
			])

			expect(state.hud.isCancelling, `status=${status}`).toBe(false)
		}
	})
})
