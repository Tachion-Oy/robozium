import { expect, type Page } from "@playwright/test"
import type { ServerResponse } from "node:http"
import { test, json, prepareRun, snapshot, message, emit, start, output, replyBox } from "./run-fixture"
import type { Backend } from "./selection-fixture"
import { reconnectDelay } from "../renderer/src/run/run-updates"

const attempts = (backend: Backend) => backend.requests.filter(request => request.path === "/run/run-one/stream").length
const retryOutput = (page: Page) => page.getByRole("button", { name: "Retry output" })
function openStream(response: ServerResponse) {
	response.writeHead(200, { "Content-Type": "text/event-stream" })
	response.write(": open\n\n")
}

test("reconnection waits 0.5, 1 and 2 seconds, then 4 seconds", () => {
	expect([0, 1, 2, 3, 4, 10].map(reconnectDelay)).toEqual([500, 1000, 2000, 4000, 4000, 4000])
})

test("a refused stream reconnects quietly, and a received frame resets the delay", async ({ desktop: { page }, backend }) => {
	prepareRun(backend)
	let refuse = true
	const streams: ServerResponse[] = []
	backend.handlers.set("GET /run/run-one/stream", response => {
		if (refuse) return json(response, { detail: "Restarting" }, 503)
		openStream(response)
		streams.push(response)
	})
	// A paused clock moves only when the test advances it. Each delay starts once the
	// client has handled the refusal and read a snapshot, in real time, so the test
	// steps the clock with short real pauses instead of measuring exact delays; the
	// schedule itself is checked above.
	await page.clock.install()
	await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 1000)
	await start(page, backend)
	const advanceUntil = async (done: () => boolean, limit: number) => {
		for (let elapsed = 0; elapsed <= limit; elapsed += 100) {
			if (done()) return elapsed
			await page.clock.runFor(100)
			await new Promise(resolve => setTimeout(resolve, 20))
		}
		throw new Error(`Not reached within ${limit} ms of page time`)
	}
	await expect.poll(() => attempts(backend)).toBe(1)
	await advanceUntil(() => attempts(backend) >= 4, 10_000)
	await expect(page.getByRole("alert")).toHaveCount(0)
	refuse = false
	await advanceUntil(() => streams.length === 1, 10_000)
	emit(streams[0], message(1, "Back"))
	await expect(output(page)).toHaveText("Back")
	streams[0].end()
	const count = attempts(backend)
	// After the frame the next attempt follows the first delay, well before the 4-second cap.
	expect(await advanceUntil(() => attempts(backend) > count, 3500)).toBeGreaterThanOrEqual(500)
	await expect(page.getByRole("alert")).toHaveCount(0)
	await expect(retryOutput(page)).toHaveCount(0)
})

test("a lost connection mid-run recovers output without duplicates and keeps the draft", async ({ desktop: { page }, backend }) => {
	const run = prepareRun(backend)
	let down = false
	let current = snapshot()
	backend.handlers.set("GET /run/run-one", response => { if (down) response.destroy(); else json(response, current) })
	await page.clock.install()
	await start(page, backend)
	await expect.poll(() => run.streams.length).toBe(1)
	emit(run.streams[0], message(1, "First"))
	await expect(output(page)).toHaveText("First")
	await replyBox(page).fill("Unsent draft")
	down = true
	backend.handlers.set("GET /run/run-one/stream", response => response.destroy())
	run.streams[0].destroy()
	// Polls and reconnection attempts fail while the backend is away.
	for (let elapsed = 0; elapsed < 12_000; elapsed += 1000) await page.clock.fastForward(1000)
	await expect(page.getByRole("alert")).toHaveCount(0)
	current = snapshot({ message_trace: [message(1, "First"), message(2, "Second")] })
	const streams: ServerResponse[] = []
	backend.handlers.set("GET /run/run-one/stream", response => { openStream(response); streams.push(response) })
	down = false
	await page.clock.fastForward(4001)
	await expect.poll(() => streams.length).toBe(1)
	emit(streams[0], message(1, "First"))
	emit(streams[0], message(2, "Second"))
	emit(streams[0], message(3, "Third"))
	await expect(output(page)).toHaveText("Third")
	await page.getByRole("button", { name: "Jump to first agent message" }).click()
	await expect(output(page)).toHaveText("First")
	const next = page.getByRole("button", { name: "Next agent message" })
	await next.click()
	await expect(output(page)).toHaveText("Second")
	await next.click()
	await expect(output(page)).toHaveText("Third")
	await expect(next).toBeDisabled()
	await expect(replyBox(page)).toHaveValue("Unsent draft")
	await expect(page.getByRole("alert")).toHaveCount(0)
	expect(backend.requests.filter(request => request.path === "/run/create")).toHaveLength(1)
})

test("failed polls stay quiet and polling keeps its two-second cadence", async ({ desktop: { page }, backend }) => {
	prepareRun(backend)
	let fail = true
	backend.handlers.set("GET /run/run-one", response => fail
		? json(response, { detail: "Busy" }, 503)
		: json(response, snapshot({ status: "awaiting_user_input", current_prompt_id: "p1", current_prompt: "Recovered prompt" })))
	await page.clock.install()
	await start(page, backend)
	const reads = () => backend.requests.filter(request => request.path === "/run/run-one").length
	await expect.poll(reads).toBe(1)
	await page.clock.fastForward(2001)
	await expect.poll(reads).toBe(2)
	fail = false
	await page.clock.fastForward(2001)
	await expect(output(page)).toHaveText("Recovered prompt")
	await expect(page.getByRole("alert")).toHaveCount(0)
})

test("a stream refusal that trying again cannot fix is reported once with Retry output", async ({ desktop: { page }, backend }) => {
	prepareRun(backend)
	backend.handlers.set("GET /run/run-one/stream", response => json(response, { detail: "Forbidden" }, 403))
	await page.clock.install()
	await start(page, backend)
	await expect(page.getByRole("alert")).toContainText("API request failed (403): Forbidden")
	await expect(retryOutput(page)).toBeEnabled()
	await page.clock.fastForward(30_000)
	expect(attempts(backend)).toBe(1)
	expect(backend.requests.filter(request => request.path === "/run/run-one").length).toBeLessThanOrEqual(1)
	const run = prepareRun(backend)
	await retryOutput(page).click()
	await expect.poll(() => run.streams.length).toBe(1)
	emit(run.streams[0], message(1, "Reconnected"))
	await expect(output(page)).toHaveText("Reconnected")
	await expect(page.getByRole("alert")).toHaveCount(0)
})
