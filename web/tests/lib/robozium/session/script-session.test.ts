import { describe, expect, it } from "vitest"
import { getHudMessages } from "@/lib/robozium/hud-messages"
import { createInitialRunSessionState, getActiveStreamingMessage, reduceRunSessionState } from "@/lib/robozium/session/reducer"
import type { RunSessionState, SessionEvent } from "@/lib/robozium/session/reducer"
import { PipeEventType, RunLifecycleKind, WireRole, type PipeEventFrame, type RunView } from "@/lib/robozium/wire"
import { StreamLogRole } from "@/lib/robozium/view-model"

const script = (sequence: number, content: string): PipeEventFrame => ({
	type: PipeEventType.ScriptOutput, sequence, payload: { content },
})
const message = (sequence: number): PipeEventFrame => ({
	type: PipeEventType.Message, sequence,
	payload: { role: WireRole.System, content: "boundary", truncation: {} },
})
const native = (sequence: number, id = "script:1"): PipeEventFrame => ({
	type: PipeEventType.MessageDelta, sequence,
	payload: { message_id: id, chunk_index: 7, role: WireRole.Assistant, agent_name: "root", sequence, delta: '{"action":"LLM"}' },
})
const lifecycle = (sequence: number, kind: RunLifecycleKind): PipeEventFrame => ({
	type: PipeEventType.RunLifecycle,
	payload: { sequence, kind, agent_name: "child", parent_agent_name: "root", status: null },
})
const runtime = (sequence: number, retry = false): PipeEventFrame => ({
	type: PipeEventType.RuntimeEvent, sequence,
	payload: { category: retry ? "llm" : "tool", kind: retry ? "retrying" : "information", level: "info", message: "runtime", agent_name: "root", data: null },
})
const received = (frame: PipeEventFrame): SessionEvent => ({ class: "stream", type: "frame_received", receivedAt: "2026-09-26T12:00:00Z", frame })
const view = (trace: PipeEventFrame[], overrides: Partial<RunView> = {}): RunView => ({
	project: "alpha", status: "running", current_agent_name: "root", parent_agent_name: null,
	message_trace: trace, current_prompt_id: null, current_prompt: null, error: null, ...overrides,
})
const snapshot = (trace: PipeEventFrame[], overrides: Partial<RunView> = {}): SessionEvent => ({
	class: "runView", type: "received", runView: view(trace, overrides),
})
const apply = (frames: PipeEventFrame[], state = createInitialRunSessionState("run")) => frames.reduce((s, f) => reduceRunSessionState(s, received(f)), state)
const displayed = (state: RunSessionState) => getHudMessages(state.hud.messages, state.hud.selectedMessageId, {
	phase: state.hud.phase, stream: getActiveStreamingMessage(state), prompt: state.hud.prompt, promptId: state.hud.promptId,
}).message
const chunks = [' \n{"value":', '"quoted \\"text\\"", ', '"markdown":"**# _ [x]`", "array": [1,', '2]}\t\n']
const exact = chunks.join("")

describe("session script groups", () => {
	it("concatenates exact chunks across runtime information and LLM retries", () => {
		let state = createInitialRunSessionState("run")
		chunks.forEach((chunk, i) => {
			state = apply([script(i * 3 + 1, chunk), runtime(i * 3 + 2), runtime(i * 3 + 3, true)], state)
			expect(displayed(state)?.content).toBe(chunks.slice(0, i + 1).join(""))
			expect(state.log.items).toEqual([])
		})
		expect(state.hud.streaming).toMatchObject({ messageId: "script:1", chunkIndex: 3, agentName: null, role: StreamLogRole.Script, contentType: "plain-text", text: exact })
		expect(displayed(state)?.contentType).toBe("plain-text")
		state = apply([message(13)], state)
		expect(state.log.items[0]).toEqual({ kind: "message", role: StreamLogRole.Script, content: exact, hudContent: { text: exact, contentType: "plain-text" } })
		expect(state.hud.messages).toHaveLength(1)
		expect(displayed(state)).toMatchObject({ content: exact, contentType: "plain-text", mode: "history" })
	})

	it.each(['{"a":1}', '{"a":', '"quoted"', '**literal** [link](x)', ' \n\t ', '{}'])(
		"preserves literal output %j after completion", text => {
			const midpoint = Math.floor(text.length / 2)
			const state = apply([script(1, text.slice(0, midpoint)), script(2, text.slice(midpoint)), message(3)])
			expect(displayed(state)?.content).toBe(text)
			expect(displayed(state)?.contentType).toBe("plain-text")
		},
	)

	const boundaries: [string, SessionEvent][] = [
		["message", received(message(3))], ["native delta", received(native(3))],
		["agent started", received(lifecycle(3, RunLifecycleKind.Started))],
		["agent stopped", received(lifecycle(3, RunLifecycleKind.Stopped))],
		["new prompt", snapshot([], { status: "awaiting_user_input", current_prompt: "Reply?", current_prompt_id: "p" })],
		["reply submitted", { class: "control", type: "reply_submitted", promptId: "p" }],
		...["completed", "failed", "cancelled"].map((status) => [status, snapshot([], { status: status as RunView["status"] })] as [string, SessionEvent]),
	]
	it.each(boundaries)("completes once before %s", (_, boundary) => {
		let state = apply([script(1, chunks[0]), script(2, chunks[1])])
		state = reduceRunSessionState(state, boundary)
		expect(state.hud.streaming?.role).not.toBe(StreamLogRole.Script)
		expect(state.log.items.filter(i => i.role === StreamLogRole.Script)).toHaveLength(1)
		expect(state.log.items[0]).toMatchObject({ content: chunks[0] + chunks[1] })
		state = reduceRunSessionState(state, boundary)
		expect(state.log.items.filter(i => i.role === StreamLogRole.Script)).toHaveLength(1)
	})

	it("uses explicit LLM metadata even when identity starts with script:", () => {
		const state = apply([script(1, "script output"), native(2)])
		expect(state.hud.streaming).toMatchObject({ messageId: "script:1", role: StreamLogRole.Agent, chunkIndex: 7, agentName: "root", contentType: "markdown", text: '{"action":"LLM"}' })
		expect(displayed(state)?.content).toBe("action:LLM")
		expect(apply([runtime(3, true)], state).hud.streaming).toBeNull()
	})

	it("starts exact script output after a native stream with the same ID", () => {
		const state = apply([native(1, "script:2"), script(2, "literal script")])
		expect(state.hud.streaming).toMatchObject({
			messageId: "script:2",
			role: StreamLogRole.Script,
			contentType: "plain-text",
			text: "literal script",
		})
		expect(displayed(state)?.content).toBe("literal script")
	})

	it("replays history and unfinished output directly, and ignores repeated snapshots", () => {
		const frames = [script(1, "first"), runtime(2), message(3), script(4, chunks[0]), script(5, chunks[1])]
		const live = apply(frames)
		const restored = reduceRunSessionState(createInitialRunSessionState("run"), snapshot([...frames].reverse()))
		expect(restored.log.items).toEqual(live.log.items)
		expect(restored.hud.streaming?.text).toBe(chunks[0] + chunks[1])
		expect(displayed(restored)?.content).toBe(chunks[0] + chunks[1])
		const repeated = reduceRunSessionState(restored, snapshot(frames))
		expect(repeated.log.items).toBe(restored.log.items)
		expect(repeated.hud.streaming).toBe(restored.hud.streaming)
		expect(apply(frames, repeated)).toBe(repeated)
	})

	it("closes replayed output at native deltas without restoring LLM snapshot tokens", () => {
		const state = reduceRunSessionState(createInitialRunSessionState("run"), snapshot([script(1, "a"), native(2), script(3, "b")]))
		expect(state.log.items).toHaveLength(1)
		expect(state.log.items[0]).toMatchObject({ content: "a" })
		expect(state.hud.streaming?.text).toBe("b")
	})

	it.each(["awaiting_user_input", "completed"] as const)("applies recovered chunks before %s snapshot boundary", (status) => {
		const initial = reduceRunSessionState(createInitialRunSessionState("run"), snapshot([script(1, "a")]))
		const state = reduceRunSessionState(initial, snapshot([script(1, "a"), script(2, "b")], {
			status, ...(status === "awaiting_user_input" ? { current_prompt_id: "p", current_prompt: "ab" } : {}),
		}))
		expect(state.log.items).toHaveLength(1)
		expect(state.log.items[0]).toMatchObject({ content: "ab", hudContent: { text: "ab", contentType: "plain-text" } })
		expect(state.hud.streaming).toBeNull()
		expect(state.hud.messages).toHaveLength(status === "awaiting_user_input" ? 2 : 1)
	})

	it("retains pinned history through output, snapshots, reconnect replay, and completion", () => {
		let state = apply([script(1, "old"), message(2)])
		state = reduceRunSessionState(state, { class: "control", type: "hud_message_navigated", direction: "first" })
		state = apply([script(3, "new")], state)
		state = reduceRunSessionState(state, snapshot([script(1, "old"), message(2), script(3, "new"), script(4, " output")], {}))
		expect(displayed(state)?.content).toBe("old")
		state = apply([message(5)], state)
		expect(state.hud.isMessageHistoryPinned).toBe(true)
		expect(displayed(state)?.content).toBe("old")
		expect(state.hud.messages.map(m => m.text)).toEqual(["old", "new output"])
		state = reduceRunSessionState(state, { class: "control", type: "hud_message_navigated", direction: "latest" })
		expect(displayed(state)?.content).toBe("new output")
	})
})
