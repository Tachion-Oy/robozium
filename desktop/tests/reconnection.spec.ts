import { expect, type Page } from "@playwright/test"
import type { ServerResponse } from "node:http"
import { test, json, prepareRun, snapshot, message, emit, start, output, replyBox } from "./run-fixture"
import type { Backend } from "./selection-fixture"

const attempts = (backend: Backend) => backend.requests.filter(request => request.path === "/run/run-one/stream").length
const retryOutput = (page: Page) => page.getByRole("button", { name: "Retry output" })
function openStream(response: ServerResponse) {
	response.writeHead(200, { "Content-Type": "text/event-stream" })
	response.write(": open\n\n")
}

test("a refused stream reconnects quietly with growing backoff, and a frame resets it", async ({ desktop: { page }, backend }) => {
	prepareRun(backend)
	let refuse = true
	const streams: ServerResponse[] = []
	backend.handlers.set("GET /run/run-one/stream", response => {
		if (refuse) return json(response, { detail: "Restarting" }, 503)
		openStream(response)
		streams.push(response)
	})
	await page.clock.install()
	await start(page, backend)
	await expect.poll(() => attempts(backend)).toBe(1)
	let count = 1
	for (const delay of [500, 1000, 2000, 4000, 4000]) {
		await page.clock.fastForward(delay - 50)
		expect(attempts(backend)).toBe(count)
		await page.clock.fastForward(51)
		await expect.poll(() => attempts(backend)).toBe(++count)
	}
	refuse = false
	await page.clock.fastForward(4001)
	await expect.poll(() => streams.length).toBe(1)
	emit(streams[0], message(1, "Back"))
	await expect(output(page)).toHaveText("Back")
	streams[0].end()
	count = attempts(backend)
	// The received frame reset the backoff to its first step.
	await page.clock.fastForward(501)
	await expect.poll(() => attempts(backend)).toBe(count + 1)
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
