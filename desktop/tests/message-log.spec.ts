import { expect, type Page } from "@playwright/test"
import { writeFile } from "node:fs/promises"
import { selectLogItems } from "../renderer/src/log/run-log"
import { parseRunEvent } from "../renderer/src/run/run-payloads"
import { cleanTailText } from "../renderer/src/ui/terminal/cleanText"
import type { RunRecord } from "../renderer/src/run/run-contracts"
import { test, json, project, snapshot, prepareRun, message, emit, start, view, launchButton, replyBox, runStatus } from "./run-fixture"
import { captureNative, setNativeViewport, waitForPanelLayout } from "./native"

const lifecycle = (sequence: number, kind: string, extra: Record<string, unknown> = {}) => ({
	type: "run_lifecycle", payload: { kind, agent_name: "orchestrator", sequence, parent_agent_name: null, status: null, model_name: "mock", ...extra },
})
const script = (sequence: number, content: string, caller = "run_shell_script") => ({ type: "script_output", sequence, payload: { content, caller } })
// RoboZ truncation rules as the backend sends them; severity 1 is Light and 3 is Remove.
const LIGHT_FROM_START = { threshold: 0, severity: 1 }
const REMOVED_FROM_START = { threshold: 0, severity: 3 }
const wire = (
	role: string, content: string, sequence: number, kind: string | null = null, caller: string | null = null, truncation: unknown = LIGHT_FROM_START,
) => ({
	type: "message", sequence, message_id: `m${sequence}`, payload: { role, content, truncation, message_kind: kind, caller },
})
const records = (...frames: unknown[]) => frames.map(frame => parseRunEvent(frame) as RunRecord)

const toggle = (page: Page, name: "Show message log" | "Hide message log") => page.getByRole("button", { name, exact: true })
const log = (page: Page) => page.getByRole("region", { name: "Message log" })
const logRunTrigger = (page: Page) => log(page).locator(".term-log-selector > button")

test("the log projects messages, grouped script output and lifecycle banners from run records", () => {
	const items = selectLogItems(records(
		lifecycle(0, "started"),
		wire("assistant", JSON.stringify({ action: "run_script", rationale: "Inspect", path: "a.py" }), 1),
		script(2, "line one\n"),
		script(3, "line two\n"),
		{ type: "runtime_event", sequence: 4, payload: { category: "llm", kind: "retrying", agent_name: "orchestrator" } },
		script(5, "after retry"),
		wire("user", "plain output", 6, "script_result"),
		wire("user", "unlabelled", 7),
		wire("user", JSON.stringify({ status: "ok", agent: "librarian" }), 8, null, "run_file_command"),
		wire("error", "Boom", 9),
		{ type: "runtime_event", sequence: 10, payload: { category: "llm", kind: "images_omitted", level: "info", agent_name: "orchestrator", message: "Images are omitted for text-model because it cannot read them." } },
		{ type: "runtime_event", sequence: 11, payload: { category: "tool", kind: "failed", level: "error", agent_name: "orchestrator", message: "Tool broke" } },
		lifecycle(12, "stopped", { status: "completed" }),
	))
	expect(items).toEqual([
		{ kind: "lifecycle", role: "lifecycle", phase: "started", agentName: "orchestrator", details: { model_name: "mock" } },
		{ kind: "message", role: "agent", content: JSON.stringify({ action: "run_script", rationale: "Inspect", path: "a.py" }),
			parsed: { kind: "assistant", action: "run_script", rationale: "Inspect", extra: { path: "a.py" } } },
		// A retry is not displayed, so it does not split the script output.
		{ kind: "message", role: "script", content: "line one\nline two\nafter retry", caller: "run_shell_script" },
		{ kind: "message", role: "tool", content: "plain output", parsed: { kind: "user", caller: "script_result", extra: {} } },
		{ kind: "message", role: "tool", content: "unlabelled" },
		{ kind: "message", role: "tool", content: JSON.stringify({ status: "ok", agent: "librarian" }),
			parsed: { kind: "user", caller: "run_file_command", extra: { status: "ok", agent: "librarian" } } },
		{ kind: "message", role: "error", content: "Boom", parsed: { kind: "error", value: "Boom" } },
		// Runtime notices are shown as written: informational ones as system rows, error-level ones as errors.
		{ kind: "message", role: "system", content: "Images are omitted for text-model because it cannot read them." },
		{ kind: "message", role: "error", content: "Tool broke" },
		{ kind: "lifecycle", role: "lifecycle", phase: "stopped", agentName: "orchestrator", status: "completed",
			details: { parent_agent_name: "null", status: "completed", model_name: "mock" } },
	])
	// The selector keeps no state: recovered history and live appends give the same rows.
	const events = records(script(1, "a"), script(2, "b"), wire("assistant", "{}", 3))
	expect(selectLogItems(events)).toEqual(selectLogItems([...events]))
	// Output another tool printed starts a row of its own.
	expect(selectLogItems(records(script(1, "a"), script(2, "b"), script(3, "c", "execute_shell_command")))).toEqual([
		{ kind: "message", role: "script", content: "ab", caller: "run_shell_script" },
		{ kind: "message", role: "script", content: "c", caller: "execute_shell_command" },
	])
})

test("the log leaves out messages the agent never sees and keeps ones removed later", () => {
	const items = selectLogItems(records(
		script(1, "before "),
		wire("user", "snapshot taken", 2, null, "snapshot_conversations", REMOVED_FROM_START),
		wire("user", "guard allowed", 3, null, "guard_files", [REMOVED_FROM_START]),
		script(4, "after"),
		wire("error", "Retrying", 5, null, null, [LIGHT_FROM_START, { threshold: 20, severity: 3 }]),
		wire("user", "old output", 6, null, null, { threshold: 5, severity: 3 }),
	))
	expect(items).toEqual([
		// A hidden message is not displayed, so it does not split the script output.
		{ kind: "message", role: "script", content: "before after", caller: "run_shell_script" },
		{ kind: "message", role: "error", content: "Retrying", parsed: { kind: "error", value: "Retrying" } },
		{ kind: "message", role: "tool", content: "old output" },
	])
})

test("a long script row keeps its newest whole lines", () => {
	const lines = Array.from({ length: 30 }, (_, i) => `12:00:${String(i).padStart(2, "0")}: No new notes.`)
	const shown = cleanTailText(`${lines.join("\n")}\n`, 100)
	expect(shown.length).toBeLessThanOrEqual(100)
	expect(shown).toBe(`…\n${lines.slice(-4).join("\n")}`)
	// Short output is shown whole, without its final line break.
	expect(cleanTailText("one\ntwo\n", 100)).toBe("one\ntwo")
})

test("the toggle opens the placeholder log before a run and the run's rows during one", async ({ desktop: { app, page }, backend }) => {
	const run = prepareRun(backend)
	await backend.open()
	await expect(log(page)).toHaveCount(0)
	await toggle(page, "Show message log").click()
	await expect(toggle(page, "Hide message log")).toHaveAttribute("aria-expanded", "true")
	await expect(page.locator(".workspace__panes")).toHaveAttribute("data-log-open", "true")
	// Without an active run the pane shows the titled placeholder log.
	await expect(log(page).locator(".term-title__brand")).toBeVisible()
	// The title is drawn from bundled art, so it must ship with the renderer.
	expect(await app.evaluate(async ({ net }) => (await net.fetch("robozium://app/branding/robozium.svg")).status)).toBe(200)
	await expect(log(page).locator(".term-msg-badge")).not.toHaveCount(0)
	await expect(log(page).locator(".term-prompt")).toHaveText("robozium@local:~$START AN AGENT TO SEE THE LIVE MESSAGES !")
	// Rows fade out at both edges of the pane rather than being cut off; the scrollbar gutter is not faded.
	expect(await log(page).locator(".term-log").evaluate(element => getComputedStyle(element).maskImage))
		.toMatch(/^linear-gradient\(rgba\(0, 0, 0, 0\), .*, rgba\(0, 0, 0, 0\)\), linear-gradient\(rgb\(0, 0, 0\), rgb\(0, 0, 0\)\)$/)
	await toggle(page, "Hide message log").click()
	await expect(log(page)).toHaveCount(0)

	await launchButton(page, "existing-project").click()
	await expect(replyBox(page)).toBeFocused()
	await expect.poll(() => run.streams.length).toBe(1)
	await toggle(page, "Show message log").click()
	await expect(log(page).locator(".term-title__brand")).toHaveCount(0)
	for (const frame of [lifecycle(1, "started"), message(2, "Hello from the agent"), script(3, "line one\n"), script(4, "line two\n")])
		emit(run.streams[0], frame)
	await expect(log(page)).toContainText("NEW PROCESS")
	await expect(log(page)).toContainText("orchestrator")
	await expect(log(page)).toContainText("Hello from the agent")
	await expect(log(page)).toContainText("line one line two")
	// Script output keeps one line per entry, unlike the crammed message rows, under the name of the tool that printed it.
	const scriptRow = log(page).locator('.term-msg[data-role="script"] .term-msg-content').last()
	expect(await scriptRow.evaluate(element => getComputedStyle(element).whiteSpace)).toBe("pre-wrap")
	await expect.poll(() => scriptRow.innerText()).toContain("run_shell_script\nline one\nline two")
	await expect(scriptRow.locator(".intro-emph__rich .term-tag")).toHaveText("run_shell_script")
	// The live log has no title, and its first row sits as far below the top as the tail's margin at the bottom.
	// Opening the log grows the window; sample once it is side by side and settled.
	const marginDifference = () => log(page).evaluate(pane => {
		const top = pane.getBoundingClientRect().top
		const scroller = pane.querySelector(".term-log")!
		const rail = scroller.parentElement!
		const content = scroller.firstElementChild!
		// Where rows begin, before any row's own margin (a lifecycle banner adds a few pixels).
		const first = content.getBoundingClientRect().top + parseFloat(getComputedStyle(content).paddingTop)
		const bottom = parseFloat(getComputedStyle(rail).paddingBottom) + parseFloat(getComputedStyle(content).paddingBottom)
		return Math.abs(first - top - bottom)
	})
	await expect.poll(marginDifference).toBeLessThanOrEqual(1)
	// The HUD keeps working beside the open log.
	await expect(page.locator(".agent-hud__replyBox--agent")).toContainText("line one line two")
	await toggle(page, "Hide message log").click()
	await expect(log(page)).toHaveCount(0)
	await expect(page.locator(".workspace__panes")).not.toHaveAttribute("data-log-open")
})

test("closing the log hides it before the window shrinks back", async ({ desktop: { app, page } }) => {
	await setNativeViewport(app, page, 900, 780, 1)
	await toggle(page, "Show message log").click()
	await expect(log(page)).toBeVisible()
	await expect.poll(() => page.evaluate(() => innerWidth)).toBeGreaterThanOrEqual(1120)
	// Sample every frame: no frame may show the log in the narrower window, where it docks below the HUD.
	await page.evaluate(() => {
		const docked: number[] = []
		Reflect.set(window, "dockedFrames", docked)
		const sample = () => {
			if (innerWidth < 1120 && document.querySelector(".message-log")) docked.push(innerWidth)
			requestAnimationFrame(sample)
		}
		requestAnimationFrame(sample)
	})
	await toggle(page, "Hide message log").click()
	await expect.poll(() => page.evaluate(() => innerWidth)).toBe(900)
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
	expect(await page.evaluate(() => Reflect.get(window, "dockedFrames") as number[])).toEqual([])
})

for (const theme of ["dark", "light"]) {
	test(`the open log sits beside or below the HUD in ${theme}`, async ({ desktop: { app, page }, backend }, testInfo) => {
		const run = prepareRun(backend)
		await start(page, backend)
		await expect.poll(() => run.streams.length).toBe(1)
		if (theme === "light") await page.getByRole("button", { name: "Toggle color theme" }).click()
		await expect(page.locator("html")).toHaveAttribute("data-theme", theme)
		emit(run.streams[0], lifecycle(1, "started"))
		emit(run.streams[0], message(2, "Hello from the agent"))
		await toggle(page, "Show message log").click()
		await expect(log(page)).toContainText("Hello from the agent")
		for (const [width, height, sideBySide] of [[1260, 780, true], [900, 780, false]] as const) {
			await setNativeViewport(app, page, width, height, 1)
			const [hud, pane] = await Promise.all([page.locator(".agent-hud").boundingBox(), log(page).boundingBox()])
			expect(sideBySide ? pane!.x >= hud!.x + hud!.width - 1 : pane!.y >= hud!.y + hud!.height - 1).toBe(true)
			expect(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth)).toBe(true)
			const screenshot = testInfo.outputPath(`message-log-${theme}-${width}.png`)
			await writeFile(screenshot, (await captureNative(app, page, width, height))!)
			await testInfo.attach(`message-log-${theme}-${width}.png`, { path: screenshot, contentType: "image/png" })
		}
	})
}

test("a message arriving at the tail slides the log up instead of jumping", async ({ desktop: { app, page }, backend }) => {
	const run = prepareRun(backend)
	await start(page, backend)
	await expect.poll(() => run.streams.length).toBe(1)
	await setNativeViewport(app, page, 1260, 780, 1)
	await toggle(page, "Show message log").click()
	for (let i = 1; i <= 3; i++) emit(run.streams[0], message(i, `Row ${i}`))
	await expect(log(page)).toContainText("Row 3")
	const column = log(page).locator(".term-log > div")
	await expect.poll(() => column.evaluate(element => element.getAnimations().length)).toBe(0)
	// Sample the column's offset every frame, however late a row arrives.
	await column.evaluate(element => {
		const offsets: number[] = []
		Reflect.set(window, "columnOffsets", offsets)
		const sample = () => {
			offsets.push(new DOMMatrixReadOnly(getComputedStyle(element).transform).m42)
			requestAnimationFrame(sample)
		}
		requestAnimationFrame(sample)
	})
	const largestOffset = async () => Math.max(...await page.evaluate(() => Reflect.get(window, "columnOffsets") as number[]))
	// With room below, a new row pushes nothing: the rows above must not move in any frame.
	emit(run.streams[0], message(4, "Row 4"))
	await expect(log(page)).toContainText("Row 4")
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
	expect(await largestOffset()).toBe(0)

	for (let i = 5; i <= 30; i++) emit(run.streams[0], message(i, `Row ${i}`))
	await expect(log(page)).toContainText("Row 30")
	await expect.poll(() => column.evaluate(element => element.getAnimations().length)).toBe(0)
	await page.evaluate(() => { (Reflect.get(window, "columnOffsets") as number[]).length = 0 })
	emit(run.streams[0], message(31, "Newest row"))
	await expect(log(page)).toContainText("Newest row")
	// The pane is full: it started lower and eased up into place.
	await expect.poll(largestOffset).toBeGreaterThan(0)
	await expect.poll(() => column.evaluate(element => element.getAnimations().length)).toBe(0)
	await expect.poll(() => column.evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).m42)).toBe(0)
	expect(await log(page).locator(".term-log").evaluate(box => box.scrollTop)).toBe(0)
})

test("scrolled up, the row being read stays put while messages arrive", async ({ desktop: { app, page }, backend }) => {
	const run = prepareRun(backend)
	await start(page, backend)
	await expect.poll(() => run.streams.length).toBe(1)
	await setNativeViewport(app, page, 1260, 780, 1)
	await toggle(page, "Show message log").click()
	for (let i = 1; i <= 40; i++) emit(run.streams[0], wire("user", JSON.stringify({ value: `Row ${i}` }), i, null, "status"))
	await expect(log(page)).toContainText("Row 40")
	// A tool row names its tool as a tag and emphasises its keys.
	const last = log(page).locator(".term-msg", { hasText: "Row 40" })
	await expect(last.locator(".intro-emph__rich .term-tag-label")).toHaveText("status")
	await expect(last.locator(".intro-emph__rich .term-emph")).toHaveText("value")
	// One GPU layer per label exhausts the tile budget in a long log, and labels then paint blank.
	expect(await log(page).locator(".term-tag-label").first().evaluate(label => getComputedStyle(label).willChange)).toBe("auto")
	const scroller = log(page).locator(".term-log")
	await scroller.evaluate(box => { box.scrollTop = -(box.scrollHeight - box.clientHeight) / 2 })
	const row = log(page).locator(".term-msg", { hasText: "Row 20" })
	await row.scrollIntoViewIfNeeded()
	// The log's opening animation moves the whole box; measure once it rests.
	await waitForPanelLayout(page)
	const before = (await row.boundingBox())!.y
	// Rows arrive one at a time, as in a run: a position error per row would add up.
	for (let i = 41; i <= 50; i++) {
		emit(run.streams[0], wire("user", JSON.stringify({ value: `Row ${i}` }), i, null, "status"))
		await expect(log(page)).toContainText(`Row ${i}`)
	}
	await expect.poll(async () => Math.abs((await row.boundingBox())!.y - before)).toBeLessThanOrEqual(1)
})

test("the log shows one page of 50 rows, follows the newest page and holds an older one", async ({ desktop: { app, page }, backend }) => {
	const run = prepareRun(backend)
	await start(page, backend)
	await expect.poll(() => run.streams.length).toBe(1)
	await setNativeViewport(app, page, 1260, 780, 1)
	await toggle(page, "Show message log").click()
	const row = (i: number) => message(i, `Row ${i}.`)
	const rows = log(page).locator(".term-msg")
	const pager = log(page).getByRole("navigation", { name: "Message log pages" })
	const older = pager.getByRole("button", { name: "‹ OLDER" })
	const newer = pager.getByRole("button", { name: "NEWER ›" })
	const scroller = log(page).locator(".term-log")
	for (let i = 1; i <= 50; i++) emit(run.streams[0], row(i))
	await expect(log(page)).toContainText("Row 50.")
	await expect(pager).toHaveCount(0)

	for (let i = 51; i <= 120; i++) emit(run.streams[0], row(i))
	// Only the newest page is in the window: rows 101-120.
	await expect(pager).toContainText("PAGE 3 / 3")
	await expect(rows).toHaveCount(20)
	await expect(rows.first()).toContainText("Row 101.")
	await expect(rows.last()).toContainText("Row 120.")
	await expect(newer).toBeDisabled()

	await older.click()
	await expect(pager).toContainText("PAGE 2 / 3")
	await expect(rows).toHaveCount(50)
	await expect(rows.first()).toContainText("Row 51.")
	await expect(rows.last()).toContainText("Row 100.")
	// Stepping back opens the older page at its tail.
	expect(await scroller.evaluate(box => box.scrollTop)).toBe(0)
	// New rows only add pages while an older page is held.
	for (let i = 121; i <= 151; i++) emit(run.streams[0], row(i))
	await expect(pager).toContainText("PAGE 2 / 4")
	await expect(rows.first()).toContainText("Row 51.")
	await expect(rows.last()).toContainText("Row 100.")

	await older.click()
	await expect(pager).toContainText("PAGE 1 / 4")
	await expect(older).toBeDisabled()
	await newer.click()
	await expect(pager).toContainText("PAGE 2 / 4")
	// Stepping forward opens the newer page at its top.
	await expect.poll(() => scroller.evaluate(box => box.scrollTop + box.scrollHeight - box.clientHeight)).toBeLessThanOrEqual(1)
	await newer.click()
	await newer.click()
	await expect(pager).toContainText("PAGE 4 / 4")
	await expect(rows).toHaveCount(1)
	// Back on the newest page, the log follows again and rolls over to the next page.
	for (let i = 152; i <= 201; i++) emit(run.streams[0], row(i))
	await expect(pager).toContainText("PAGE 5 / 5")
	await expect(rows).toHaveCount(1)
	await expect(rows.first()).toContainText("Row 201.")
})

test("the log shows the run chosen in its own selector until a run is opened", async ({ desktop: { page }, backend }) => {
	let listing = [
		project("first-project", { status: "awaiting_user_input", run_id: "run-first" }),
		project("second-project", { status: "running", run_id: "run-second" }),
	]
	backend.handlers.set("GET /projects", response => json(response, listing))
	backend.handlers.set("GET /credentials/environment", response => json(response, {
		revision: "r1", entries: [], overrides: [], requires_password: false, editable: true, suggestions: [], example_errors: [], imports: [],
	}))
	const first = prepareRun(backend, "run-first", "first-project")
	const second = prepareRun(backend, "run-second", "second-project")
	await backend.open()
	await page.getByRole("button", { name: "Open first-project", exact: true }).click()
	await expect(runStatus(page)).toContainText("first-project")
	await expect.poll(() => first.streams.length).toBe(1)
	emit(first.streams[0], message(1, "First says hello"))
	await toggle(page, "Show message log").click()
	await expect(log(page)).toContainText("First says hello")
	await expect(logRunTrigger(page)).toHaveText("first-project▴")

	// The list rises above the button and marks the shown run.
	await logRunTrigger(page).click()
	const runs = log(page).getByRole("listbox", { name: "Log runs" })
	await expect(runs.getByRole("option")).toHaveText(["first-project●", "second-project"])
	const menuBottom = (await runs.boundingBox())!.y + (await runs.boundingBox())!.height
	expect(menuBottom).toBeLessThanOrEqual((await logRunTrigger(page).boundingBox())!.y)
	await page.keyboard.press("Escape")
	await expect(runs).toHaveCount(0)

	// Choosing another run changes the log only.
	await logRunTrigger(page).click()
	await runs.getByRole("option", { name: "second-project" }).click()
	await expect.poll(() => second.streams.length).toBe(1)
	emit(second.streams[0], message(1, "Second reporting"))
	await expect(log(page)).toContainText("Second reporting")
	await expect(log(page)).not.toContainText("First says hello")
	await expect(runStatus(page)).toContainText("first-project")
	await expect(page.locator(".agent-hud__run-trigger")).toHaveAttribute("title", "first-project")

	// Other screens keep the log's run.
	await view(page, "Runs Overview")
	await expect(log(page)).toContainText("Second reporting")
	await view(page, "Environment")
	await expect(log(page)).toContainText("Second reporting")

	// Opening a run shows it in the log again.
	await view(page, "Runs Overview")
	await page.getByRole("button", { name: "Open first-project", exact: true }).click()
	await expect(log(page)).toContainText("First says hello")
	await expect(logRunTrigger(page)).toHaveText("first-project▴")

	// The log's run ending leaves the placeholder; the selector still offers the live run.
	await logRunTrigger(page).click()
	await runs.getByRole("option", { name: "second-project" }).click()
	// The mock's snapshots carry no history, so the new watch hears the message again.
	await expect.poll(() => second.streams.length).toBe(2)
	emit(second.streams[1], message(1, "Second reporting"))
	await expect(log(page)).toContainText("Second reporting")
	listing = [listing[0], project("second-project")]
	backend.handlers.set("GET /run/run-second", response => json(response, snapshot({ project: "second-project", status: "completed" })))
	await expect(log(page).locator(".term-title__brand")).toBeVisible()
	await expect(logRunTrigger(page)).toHaveText("Live runs▴")
	await logRunTrigger(page).click()
	await expect(runs.getByRole("option")).toHaveText(["first-project"])
	await page.keyboard.press("Escape")

	// Without live runs the list only says where runs are launched.
	listing = [project("first-project"), project("second-project")]
	backend.handlers.set("GET /run/run-first", response => json(response, snapshot({ project: "first-project", status: "completed" })))
	await expect(log(page).locator(".term-title__brand")).toBeVisible()
	await logRunTrigger(page).click()
	await expect(runs.getByRole("option")).toHaveCount(0)
	await expect(runs).toContainText("Launch more from Runs Overview")
})
