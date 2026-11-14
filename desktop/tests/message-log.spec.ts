import { expect, type Page } from "@playwright/test"
import { writeFile } from "node:fs/promises"
import { selectLogItems } from "../renderer/src/log/run-log"
import { parseRunEvent } from "../renderer/src/run/run-payloads"
import type { RunRecord } from "../renderer/src/run/run-contracts"
import { test, prepareRun, message, emit, start, launchButton, replyBox } from "./run-fixture"
import { captureNative, setNativeViewport } from "./native"

const lifecycle = (sequence: number, kind: string, extra: Record<string, unknown> = {}) => ({
	type: "run_lifecycle", payload: { kind, agent_name: "orchestrator", sequence, parent_agent_name: null, status: null, model_name: "mock", ...extra },
})
const script = (sequence: number, content: string) => ({ type: "script_output", sequence, payload: { content } })
const wire = (role: string, content: string, sequence: number, kind: string | null = null, caller: string | null = null) => ({
	type: "message", sequence, message_id: `m${sequence}`, payload: { role, content, message_kind: kind, caller },
})
const records = (...frames: unknown[]) => frames.map(frame => parseRunEvent(frame) as RunRecord)

const toggle = (page: Page, name: "Show message log" | "Hide message log") => page.getByRole("button", { name, exact: true })
const log = (page: Page) => page.getByRole("region", { name: "Message log" })

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
		{ kind: "message", role: "script", content: "line one\nline two\nafter retry" },
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
	for (const frame of [lifecycle(1, "started"), message(2, "Hello from the agent"), script(3, "line one "), script(4, "line two")])
		emit(run.streams[0], frame)
	await expect(log(page)).toContainText("NEW PROCESS")
	await expect(log(page)).toContainText("orchestrator")
	await expect(log(page)).toContainText("Hello from the agent")
	await expect(log(page)).toContainText("line one line two")
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
	for (let i = 1; i <= 30; i++) emit(run.streams[0], message(i, `Row ${i}`))
	await expect(log(page)).toContainText("Row 30")
	const column = log(page).locator(".term-log > div")
	await expect.poll(() => column.evaluate(element => element.getAnimations().length)).toBe(0)
	// Sample the column's offset every frame, however late the row arrives.
	await column.evaluate(element => {
		const offsets: number[] = []
		Reflect.set(window, "columnOffsets", offsets)
		const sample = () => {
			offsets.push(new DOMMatrixReadOnly(getComputedStyle(element).transform).m42)
			requestAnimationFrame(sample)
		}
		requestAnimationFrame(sample)
	})
	emit(run.streams[0], message(31, "Newest row"))
	await expect(log(page)).toContainText("Newest row")
	// It started lower and eased up into place.
	await expect.poll(async () => Math.max(...await page.evaluate(() => Reflect.get(window, "columnOffsets") as number[]))).toBeGreaterThan(0)
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
	const before = (await row.boundingBox())!.y
	for (let i = 41; i <= 50; i++) emit(run.streams[0], wire("user", JSON.stringify({ value: `Row ${i}` }), i, null, "status"))
	await expect(log(page)).toContainText("Row 50")
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
