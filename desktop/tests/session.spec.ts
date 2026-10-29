import { expect, test } from "@playwright/test"
import { parseRunEvent } from "../renderer/src/run/run-payloads"
import type { RunFrame, RunView } from "../renderer/src/run/run-contracts"
import { reduceRunSession, selectRunDisplay, type RunSession } from "../renderer/src/session/session-reducer"
import { initialRun, reduceRun } from "../renderer/src/run/run-reducer"

function session(): RunSession {
	return reduceRunSession(null, { type: "open", runId: "run", project: "project" })!
}
function receive(state: RunSession, ...frames: RunFrame[]): RunSession {
	for (const frame of frames) state = reduceRunSession(state, { type: "frame", frame })!
	return state
}
function delta(sequence: number, id: string, text: string, chunk = 0, agent = "root"): RunFrame {
	return { type: "message_delta", sequence, id, delta: text, chunk, agent }
}
function message(sequence: number, id: string, content: string, kind: string | null = "user_notification"): RunFrame {
	return { type: "message", sequence, id, content, kind, role: "assistant" }
}
function snapshot(state: RunSession, overrides: Partial<RunView>): RunSession {
	return reduceRunSession(state, { type: "snapshot", view: {
		project: "project", status: "running", frames: [], promptId: null, prompt: null, error: null, ...overrides,
	} })!
}
function select(state: RunSession, index: number): RunSession {
	return reduceRunSession(state, { type: "select", index })!
}
const working = "Agent is working..."
const retry = (sequence: number, agent = "root"): RunFrame => ({ type: "llm_retry", sequence, agent })
const script = (sequence: number, content: string): RunFrame => ({ type: "script_output", sequence, content })

test("run reconciliation accepts live prefixes after recovery and rejects duplicate or completed chunks without a HUD", () => {
	let run = initialRun("run", "project")
	const completed = message(6, "background", "Background")
	run = reduceRun(run, { type: "snapshot", view: {
		project: "project", status: "running", frames: [completed], promptId: null, prompt: null, error: null,
	} }).run
	const prefix = reduceRun(run, { type: "frame", frame: delta(5, "active", "Prefix") })
	expect(prefix.type).toBe("delta")
	expect(prefix.run.events).toEqual([completed])
	const duplicate = reduceRun(prefix.run, { type: "frame", frame: delta(7, "active", "Duplicate", 0) })
	expect(duplicate.type).toBe("state")
	const continuation = reduceRun(duplicate.run, { type: "frame", frame: delta(8, "active", " continued", 1) })
	expect(continuation.type).toBe("delta")
	const done = message(9, "active", "Complete")
	run = reduceRun(continuation.run, { type: "frame", frame: done }).run
	const late = reduceRun(run, { type: "frame", frame: delta(10, "active", "Obsolete", 2) })
	expect(late.type).toBe("state")
	expect(late.run.events).toEqual([completed, done])
})

test("history selection changes presentation while identical backend updates produce identical run state", () => {
	let following = receive(session(), message(1, "first", "First"), message(2, "second", "Second"))
	let pinned = select(following, 0)
	expect(pinned.run).toBe(following.run)
	const next = delta(3, "live", "Working")
	following = receive(following, next)
	pinned = receive(pinned, next)
	expect(pinned.run).toEqual(following.run)
	expect(selectRunDisplay(following).text).toBe("Working")
	expect(selectRunDisplay(pinned).text).toBe("First")
	const final = { status: "completed", frames: [message(4, "live", "Done")] } as const
	following = snapshot(following, { ...final, frames: [...final.frames] })
	pinned = snapshot(pinned, { ...final, frames: [...final.frames] })
	expect(pinned.run).toEqual(following.run)
	expect(selectRunDisplay(following)).toMatchObject({ text: "Done", streaming: false })
	expect(selectRunDisplay(pinned)).toMatchObject({ text: "First", streaming: false })
})

test("recovered script output before a live attempt rejoins the earlier group", () => {
	let state = receive(session(), script(1, "Before"), delta(5, "live", "Working"))
	state = select(state, 0)
	state = snapshot(state, { frames: [script(3, " recovered")] })
	expect(selectRunDisplay(state).text).toBe("Before recovered")
	state = receive(state, script(6, "After"))
	expect(state.hud.view.messages.map(item => item.text)).toEqual(["Before recovered", "After"])
	expect(selectRunDisplay(state).text).toBe("Before recovered")
})

test("replayed chunks cannot cover script output after the live presentation was cleared", () => {
	let state = receive(session(), delta(1, "live", "Working"), script(2, "Script output"))
	state = receive(state, delta(3, "live", "Working", 0))
	expect(selectRunDisplay(state).text).toBe("Script output")
})

for (const source of ["SSE", "snapshot"] as const) {
	test(`mixed message content and script boundaries project consistently from ${source}`, () => {
		const literal = '{"action":"prompt_user","value":"Show this JSON literally"}'
		const events: RunFrame[] = [
			script(1, "First"), retry(2), script(3, " continued"),
			message(4, "internal", "null", null), script(5, "Second"),
			message(6, "question", '{"action":"prompt_user","value":"Continue?"}', null),
			{ type: "message", sequence: 7, id: "error", role: "error", kind: null, content: "Problem" },
			message(8, "notification", literal),
			{ type: "message", sequence: 9, id: "reply", role: "user", kind: null, content: "Hidden reply" },
			script(10, "Third"),
		]
		const state = source === "SSE" ? receive(session(), ...events) : snapshot(session(), { frames: events })
		expect(state.hud.view.messages.map(item => item.text)).toEqual([
			"First continued", "Second", "Continue?", literal, "Third",
		])
		expect(selectRunDisplay(state)).toMatchObject({ text: "Third", count: 5, streaming: true })
	})
}

test("retry controls are validated and unrelated runtime diagnostics stay out of the HUD", () => {
	const wire = { type: "runtime_event", sequence: 4, payload: { category: "llm", kind: "retrying", agent_name: "root" } }
	expect(parseRunEvent(wire)).toEqual(retry(4))
	expect(() => parseRunEvent({ ...wire, payload: { ...wire.payload, agent_name: 42 } })).toThrow("invalid run data")
	expect(() => parseRunEvent({ ...wire, sequence: -1 })).toThrow("invalid run data")
	expect(parseRunEvent({ ...wire, payload: { category: "tool", kind: "started" } })).toBeNull()
})

test("a provider retry discards only its transient attempt and snapshot replay cannot resurrect it", () => {
	let state = receive(session(), message(1, "old", "Earlier"), delta(2, "attempt-1", "Abandoned"))
	const beforeRetry = state
	state = receive(state, retry(3))
	expect(selectRunDisplay(state)).toMatchObject({ text: working, streaming: true, count: 2 })
	expect(selectRunDisplay(beforeRetry).text).toBe("Abandoned") // Reducers leave earlier states untouched.
	state = receive(state, delta(4, "attempt-2", "Success"), message(5, "attempt-2", "Success"))
	state = snapshot(state, { frames: [delta(2, "attempt-1", "Abandoned"), retry(3), message(5, "attempt-2", "Success")] })
	expect(state.hud.view.messages.map(item => item.text)).toEqual(["Earlier", "Success"])
	expect(selectRunDisplay(state).count).toBe(2)
})

test("background retries and stale retry snapshots do not clear newer foreground output or scripts", () => {
	let state = receive(session(), delta(4, "active", "Keep"), retry(5, "librarian"))
	expect(selectRunDisplay(state).text).toBe("Keep")
	state = snapshot(state, { frames: [retry(3)] })
	expect(selectRunDisplay(state).text).toBe("Keep")
	state = receive(state, { type: "script_output", sequence: 6, content: "Script\n" }, retry(7),
		{ type: "script_output", sequence: 8, content: "continued" })
	expect(selectRunDisplay(state).text).toBe("Script\ncontinued")
	expect(selectRunDisplay(state).count).toBe(1)
})

test("an active prompt wins over later notifications while explicit history selections remain pinned", () => {
	let state = snapshot(session(), {
		status: "awaiting_user_input", promptId: "p1", prompt: "Continue?",
		frames: [message(1, "old", "Earlier"), message(2, "question", "Continue?"), message(3, "background", "Background")],
	})
	expect(selectRunDisplay(state)).toMatchObject({ text: "Continue?", index: 1, currentIndex: 1, count: 3 })
	state = select(state, 2)
	state = receive(state, message(4, "next", "Another background notification"))
	expect(selectRunDisplay(state).text).toBe("Background")
	state = select(state, selectRunDisplay(state).currentIndex)
	expect(selectRunDisplay(state).text).toBe("Continue?")
	state = snapshot(state, { status: "awaiting_user_input", promptId: "p2", prompt: "Next question?" })
	expect(selectRunDisplay(state).text).toBe("Next question?")
	state = snapshot(state, { status: "completed", frames: [message(5, "done", "Done")] })
	expect(selectRunDisplay(state)).toMatchObject({ text: "Done", streaming: false })
})

test("snapshot-only prompt changes retain a pinned notification and latest returns to the new question", () => {
	let state = snapshot(session(), { status: "awaiting_user_input", promptId: "p1", prompt: "First?" })
	state = receive(state, message(1, "background", "Background"))
	// The question is current; select background, then replace the active prompt.
	state = select(state, 0)
	state = snapshot(state, { status: "awaiting_user_input", promptId: "p2", prompt: "Second?" })
	expect(selectRunDisplay(state).text).toBe("Background")
	state = select(state, selectRunDisplay(state).currentIndex)
	expect(selectRunDisplay(state).text).toBe("Second?")
})

test("a snapshot overtaking SSE does not discard an unfinished stream's prefix", () => {
	let state = snapshot(session(), { frames: [message(6, "background", "Background notification")] })
	state = receive(state, delta(5, "active", "Prefix"), delta(7, "active", " continued", 1))
	expect(selectRunDisplay(state).text).toBe("Prefix continued")
	state = snapshot(state, { frames: [message(8, "active", "Complete")] })
	state = receive(state, delta(9, "active", " obsolete", 2))
	expect(selectRunDisplay(state).text).toBe("Complete")
})

test("a recovered stream boundary splits script groups without duplicating pinned identities", () => {
	let state = snapshot(session(), { frames: [
		{ type: "script_output", sequence: 1, content: "First script" },
		{ type: "script_output", sequence: 4, content: "Second script" },
		message(6, "last", "Latest"),
	] })
	state = select(state, 0)
	state = receive(state, delta(3, "between", "Between scripts"))
	expect(state.hud.view.messages.map(item => item.id)).toEqual(["script:1", "script:4", "message:last"])
	expect(selectRunDisplay(state).text).toBe("First script")
	state = select(state, 1)
	expect(selectRunDisplay(state).text).toBe("Second script")
})

test("ordinary completion settles visible text in the streaming style until output or a prompt replaces it", () => {
	let state = receive(session(), message(1, "old", "Earlier"), delta(2, "tool", '{"action":"working"'))
	state = receive(state, message(3, "tool", '{"action":"tool","value":"work"}', null))
	expect(selectRunDisplay(state)).toMatchObject({ text: "action:working", streaming: true })
	expect(state.hud.view.messages.map(item => item.text)).toEqual(["Earlier"])
	state = snapshot(state, {})
	expect(selectRunDisplay(state)).toMatchObject({ text: "action:working", streaming: true })
	state = receive(state, delta(4, "next", "Next action"))
	expect(selectRunDisplay(state).text).toBe("Next action")
	state = snapshot(state, { status: "awaiting_user_input", promptId: "p1", prompt: "Continue?" })
	expect(selectRunDisplay(state).text).toBe("Continue?")
})

test("ordinary completion never displaces pinned history and retry clears settling text", () => {
	let state = receive(session(), message(1, "old", "Earlier"), delta(2, "tool", "Working"))
	state = select(state, 0)
	state = receive(state, message(3, "tool", "internal action", null))
	expect(selectRunDisplay(state).text).toBe("Earlier")
	state = select(state, selectRunDisplay(state).currentIndex)
	expect(selectRunDisplay(state).text).toBe("Working")
	state = receive(state, retry(4))
	expect(selectRunDisplay(state)).toMatchObject({ text: working, count: 2 })
})

test("an interrupted generation keeps its cut-off text in the streaming style until the interrupt prompt", () => {
	let state = receive(session(), message(1, "old", "Earlier"), delta(2, "cut", '{"action":"prompt_user","value":"Half a son'))
	// The backend gives the streamed id to the next message: its interrupted-generation context.
	state = receive(state, message(3, "cut", "The previous assistant generation was interrupted.", "interrupted_generation"))
	expect(selectRunDisplay(state)).toMatchObject({ text: "action:prompt_user,value:Half a son", streaming: true })
	state = snapshot(state, { status: "awaiting_user_input", promptId: "p1", prompt: "Action interrupted!" })
	expect(selectRunDisplay(state)).toMatchObject({ text: "Action interrupted!", streaming: false })
})

test("an acknowledged reply resumes the run until a snapshot shows another prompt", () => {
	let state = snapshot(session(), { status: "awaiting_user_input", promptId: "p1", prompt: "Continue?" })
	state = reduceRunSession(state, { type: "replied", promptId: "p1" })!
	expect(state.run.status).toBe("running")
	// A snapshot taken before the reply still awaits the answered prompt.
	state = snapshot(state, { status: "awaiting_user_input", promptId: "p1", prompt: "Continue?" })
	expect(state.run).toMatchObject({ status: "running", prompt: null })
	state = snapshot(state, { status: "awaiting_user_input", promptId: "p2", prompt: "Next?" })
	expect(state.run.status).toBe("awaiting_user_input")
})

test("a launch and an acknowledged reply show the agent working until visible output arrives", () => {
	let state = session()
	expect(selectRunDisplay(state)).toMatchObject({ text: working, contentType: "plain-text", streaming: true, count: 1 })
	state = snapshot(state, { status: "awaiting_user_input", promptId: "p1", prompt: "Continue?", frames: [message(1, "q", "Continue?")] })
	expect(selectRunDisplay(state)).toMatchObject({ text: "Continue?", streaming: false, count: 1 })
	state = reduceRunSession(state, { type: "replied", promptId: "p1" })!
	expect(selectRunDisplay(state)).toMatchObject({ text: working, streaming: true, index: 1, count: 2 })
	// Earlier messages stay reachable, and a snapshot without new output keeps the indicator.
	state = select(state, 0)
	expect(selectRunDisplay(state).text).toBe("Continue?")
	state = select(state, 1)
	state = snapshot(state, { frames: [message(1, "q", "Continue?")] })
	expect(selectRunDisplay(state).text).toBe(working)
	// Leading JSON punctuation has no visible text yet.
	state = receive(state, delta(2, "next", '{"'))
	expect(selectRunDisplay(state)).toMatchObject({ text: working, streaming: true, count: 2 })
	state = receive(state, delta(3, "next", "action", 1))
	expect(selectRunDisplay(state)).toMatchObject({ text: "action", streaming: true, count: 2 })
	state = receive(state, message(4, "notice", "Background done"))
	expect(selectRunDisplay(state)).toMatchObject({ text: "Background done", streaming: false, count: 2 })
	state = snapshot(state, { status: "completed" })
	expect(selectRunDisplay(state)).toMatchObject({ text: "Background done", count: 2 })
})

test("recovered history fills older gaps without replaying completed tokens or duplicating message identities", () => {
	let state = receive(session(), delta(10, "active", "Live"), delta(11, "active", " output", 1), delta(12, "active", " duplicate", 1))
	state = snapshot(state, { frames: [message(2, "old", "Older"), message(1, "first", "First")] })
	expect(selectRunDisplay(state).text).toBe("Live output")
	state = receive(state, message(13, "active", "Finished"), message(14, "active", "Finished"), delta(15, "active", "obsolete", 2))
	expect(state.hud.view.messages.map(item => item.text)).toEqual(["First", "Older", "Finished"])
	expect(selectRunDisplay(state).count).toBe(3)
})

test("completed attempts retain no token frames and delta work does not traverse accumulated history", () => {
	let state = session()
	let sequence = 0
	for (let attempt = 0; attempt < 100; attempt++) {
		for (let chunk = 0; chunk < 1000; chunk++) state = receive(state, delta(++sequence, `m${attempt}`, "x", chunk))
		state = receive(state, message(++sequence, `m${attempt}`, `Complete ${attempt}`))
	}
	// Run records contain only the 100 completions; display boundaries stay in the HUD.
	expect(state.run.events).toHaveLength(100)
	expect(state.hud.history.breaks).toHaveLength(100)
	expect(state.hud.liveText).toBeNull()
	state = receive(state, delta(++sequence, "next", "New"))
	const history = state.run.events
	const completed = state.hud.view.messages
	state = receive(state, delta(++sequence, "next", " token", 1))
	expect(state.run.events).toBe(history)
	expect(state.hud.view.messages).toBe(completed)
	expect(selectRunDisplay(state).text).toBe("New token")
})

test("prefix recovery followed by a split keeps unique script identities and both groups reachable", () => {
	let state = receive(session(), script(4, "Later"), message(8, "last", "Latest"))
	state = select(state, 0)
	const selectedId = selectRunDisplay(state).id
	state = snapshot(state, { frames: [script(2, "Prefix")] })
	expect(selectRunDisplay(state)).toMatchObject({ id: selectedId, text: "PrefixLater" })
	state = snapshot(state, { frames: [{ type: "run_lifecycle", sequence: 3, kind: "started", agent: "root", status: null, details: {} }] })
	expect(selectRunDisplay(state)).toMatchObject({ id: selectedId, text: "Later" })
	expect(state.hud.view.messages.map(item => item.id)).toEqual(["script:2", "script:4", "message:last"])
	state = select(state, 0)
	expect(selectRunDisplay(state).text).toBe("Prefix")
	state = select(state, 1)
	expect(selectRunDisplay(state).text).toBe("Later")
	state = snapshot(state, { frames: [script(1, "Earlier"), script(2, "Prefix"), script(4, "Later")] })
	expect(selectRunDisplay(state)).toMatchObject({ id: selectedId, text: "Later" })
	expect(new Set(state.hud.view.messages.map(item => item.id)).size).toBe(state.hud.view.messages.length)
})

for (const delivery of ["SSE", "unchanged snapshot", "snapshot with older recovery"] as const) {
	test(`duplicate script via ${delivery} dismisses older live text without duplicating history`, () => {
		const output = script(6, "Newer script output")
		let state = snapshot(session(), { frames: [output] })
		state = receive(state, delta(5, "old", "Older LLM text"))
		expect(selectRunDisplay(state).text).toBe("Older LLM text")
		if (delivery === "SSE") state = receive(state, output)
		else state = snapshot(state, { frames: delivery === "unchanged snapshot" ? [output] : [message(1, "first", "Earlier"), output] })
		expect(selectRunDisplay(state)).toMatchObject({ text: "Newer script output", streaming: true })
		state = receive(state, script(7, " continued"))
		expect(selectRunDisplay(state).text).toBe("Newer script output continued")
		expect(state.hud.history.messages.filter(item => item.source === "script")).toHaveLength(1)
	})
}

test("replaying older durable output leaves newer live text intact", () => {
	const output = script(6, "Older script output")
	let state = receive(session(), output, delta(7, "new", "Newer LLM output"))
	state = receive(state, output)
	state = snapshot(state, { frames: [output] })
	expect(selectRunDisplay(state).text).toBe("Newer LLM output")
	state = receive(state, delta(8, "new", " continued", 1))
	expect(selectRunDisplay(state).text).toBe("Newer LLM output continued")
})

test("a prompt keeps pinned scripts separate through dismissal, continuation and recovery", () => {
	let state = receive(session(), script(2, "Before"))
	state = snapshot(state, { status: "awaiting_user_input", promptId: "p1", prompt: "Continue?", frames: [script(2, "Before")] })
	state = select(state, 0)
	const selectedId = selectRunDisplay(state).id
	state = snapshot(state, {})
	state = receive(state, script(4, "After"))
	expect(selectRunDisplay(state)).toMatchObject({ id: selectedId, text: "Before", streaming: false })
	state = snapshot(state, { frames: [script(1, "Prefix"), script(2, "Before"), script(4, "After")] })
	expect(selectRunDisplay(state)).toMatchObject({ id: selectedId, text: "PrefixBefore", streaming: false })
	expect(state.hud.view.messages.map(item => item.text)).toEqual(["PrefixBefore", "After"])
	state = snapshot(state, { frames: [script(4, "After")] })
	state = receive(state, script(5, " continued"))
	expect(selectRunDisplay(state)).toMatchObject({ id: selectedId, text: "PrefixBefore" })
	state = select(state, selectRunDisplay(state).currentIndex)
	expect(selectRunDisplay(state).text).toBe("After continued")
})

test("a status-only prompt snapshot closes the existing script group", () => {
	let state = receive(session(), script(1, "Before"))
	state = snapshot(state, { status: "awaiting_user_input", promptId: "p1", prompt: "Continue?" })
	state = snapshot(state, { frames: [script(1, "Before")] })
	state = receive(state, script(2, "After"))
	expect(state.hud.view.messages.map(item => item.text)).toEqual(["Before", "After"])
})

test("a delayed prompt snapshot splits scripts at its capture point without moving the boundary on repeated polls", () => {
	let state = receive(session(), script(2, "Before"), script(4, "After"))
	const prompt = { status: "awaiting_user_input", promptId: "p1", prompt: "Continue?" } as const
	state = snapshot(state, { ...prompt, frames: [script(2, "Before")] })
	expect(state.hud.view.messages.map(item => item.text)).toEqual(["Before", "After", "Continue?"])
	state = snapshot(state, { ...prompt, frames: [script(2, "Before"), script(4, "After")] })
	state = snapshot(state, {})
	state = receive(state, script(5, " continued"))
	expect(state.hud.view.messages.map(item => item.text)).toEqual(["Before", "After continued"])
})

test("agent messages and prompts render as Markdown while live text and scripts stay literal", () => {
	let state = receive(session(), message(1, "note", "**Done**"))
	expect(selectRunDisplay(state)).toMatchObject({ text: "**Done**", contentType: "markdown" })
	state = receive(state, delta(2, "live", "**partial"))
	expect(selectRunDisplay(state)).toMatchObject({ text: "**partial", contentType: "plain-text", streaming: true })
	state = receive(state, script(3, "$ ls *.md"))
	expect(selectRunDisplay(state)).toMatchObject({ text: "$ ls *.md", contentType: "plain-text" })
	state = snapshot(state, { status: "awaiting_user_input", promptId: "p1", prompt: "Pick **one**" })
	expect(selectRunDisplay(state)).toMatchObject({ text: "Pick **one**", contentType: "markdown" })
	expect(selectRunDisplay(null).contentType).toBe("plain-text")
})
