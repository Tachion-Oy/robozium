import { expect, type Page } from "@playwright/test"
import type { ServerResponse } from "node:http"
import { test, json, prepareRun, snapshot, message, emit, start, output, view } from "./run-fixture"

async function freezeTime(page: Page) {
	const time = new Date("2026-01-01T00:00:00Z")
	await page.clock.install({ time })
	await page.clock.pauseAt(time)
}

test("stream failures back off from 500 ms to four seconds and recover without duplicate history", async ({ desktop: { page }, backend }) => {
	const run = prepareRun(backend)
	const open = backend.handlers.get("GET /run/run-one/stream")!
	let attempts = 0
	backend.handlers.set("GET /run/run-one/stream", (response, body) => {
		attempts++
		if (attempts <= 5) json(response, { detail: "Temporarily unavailable" }, 503)
		else open(response, body)
	})
	backend.handlers.set("GET /run/run-one", response => json(response, snapshot({ message_trace: [message(1, "Retained")] })))
	await freezeTime(page)
	await start(page, backend)
	await expect(page.getByRole("alert")).toContainText("Temporarily unavailable")
	await page.getByRole("textbox", { name: "Reply", exact: true }).fill("Keep my draft")
	for (const [index, delay] of [500, 1000, 2000, 4000, 4000].entries()) {
		await page.clock.fastForward(delay - 1)
		expect(attempts).toBe(index + 1)
		await page.clock.fastForward(1)
		await expect.poll(() => attempts).toBe(index + 2)
		if (index < 4) await expect(page.getByRole("alert")).toContainText("Temporarily unavailable")
	}
	await expect.poll(() => run.streams.length).toBe(1)
	await expect(page.getByRole("alert")).toHaveCount(0)
	emit(run.streams[0], message(1, "Retained"))
	emit(run.streams[0], message(2, "Recovered"))
	await expect(output(page)).toHaveText("Recovered")
	await page.getByRole("button", { name: "Previous agent message", exact: true }).click()
	await expect(output(page)).toHaveText("Retained")
	await expect(page.getByRole("button", { name: "Previous agent message", exact: true })).toBeDisabled()
	await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("Keep my draft")
	expect(backend.requests.filter(request => request.path === "/run/create")).toHaveLength(1)
})

test("opening a stream queues a fresh serialized snapshot to recover missed events", async ({ desktop: { page }, backend }) => {
	prepareRun(backend)
	const reads: ServerResponse[] = []
	let stream: ServerResponse | undefined
	backend.handlers.set("GET /run/run-one", response => reads.push(response))
	backend.handlers.set("GET /run/run-one/stream", response => { stream = response })
	await freezeTime(page)
	await start(page, backend)
	await expect.poll(() => reads.length).toBe(1)
	await expect.poll(() => stream).toBeDefined()
	stream!.writeHead(200, { "Content-Type": "text/event-stream" })
	stream!.write(": opened\n\n")
	await page.clock.fastForward(1000)
	expect(reads).toHaveLength(1)
	json(reads[0], snapshot({ message_trace: [message(1, "Before subscription")] }))
	await expect.poll(() => reads.length).toBe(2)
	json(reads[1], snapshot({ message_trace: [message(1, "Before subscription"), message(2, "Missed event")] }))
	await expect(output(page)).toHaveText("Missed event")
	emit(stream!, message(2, "Missed event"))
	await page.getByRole("button", { name: "Previous agent message", exact: true }).click()
	await expect(output(page)).toHaveText("Before subscription")
})

for (const failure of ["closure", "snapshot timeout", "stream timeout"] as const) {
	test(`${failure} reconnects and a replacement run disposes obsolete retries`, async ({ desktop: { page }, backend }) => {
		const run = prepareRun(backend)
		const read = backend.handlers.get("GET /run/run-one")!
		const stream = backend.handlers.get("GET /run/run-one/stream")!
		let stalled: ServerResponse | undefined
		if (failure !== "closure") backend.handlers.set(failure === "snapshot timeout" ? "GET /run/run-one" : "GET /run/run-one/stream", response => { stalled = response })
		await freezeTime(page)
		await start(page, backend)
		if (failure === "closure") {
			await expect.poll(() => run.streams.length).toBe(1)
			run.streams[0].end()
		} else {
			await expect.poll(() => stalled).toBeDefined()
			await page.clock.fastForward(10_001)
		}
		await expect(page.getByRole("alert")).toContainText(failure === "closure" ? "disconnected" : "timed out")
		backend.handlers.set("GET /run/run-one", read)
		backend.handlers.set("GET /run/run-one/stream", stream)
		await page.clock.fastForward(501)
		await expect(page.getByRole("alert")).toHaveCount(0)
		await view(page, "Runs Overview")
		prepareRun(backend, "replacement")
		await page.getByRole("button", { name: "Start run", exact: true }).click()
		await expect.poll(() => backend.requests.filter(request => request.path === "/run/replacement/stream").length).toBe(1)
		const oldRequests = backend.requests.filter(request => request.path.startsWith("/run/run-one")).length
		await page.clock.fastForward(30_000)
		expect(backend.requests.filter(request => request.path.startsWith("/run/run-one"))).toHaveLength(oldRequests)
	})
}

for (const failure of ["missing", "forbidden", "malformed"] as const) {
	test(`${failure} stops automatic run recovery`, async ({ desktop: { page }, backend }) => {
		const run = prepareRun(backend)
		backend.handlers.set("GET /run/run-one", response => json(response, failure === "malformed" ? snapshot({ status: "invalid" }) : { detail: "Unavailable" }, failure === "missing" ? 404 : failure === "forbidden" ? 403 : 200))
		await freezeTime(page)
		await start(page, backend)
		await expect(page.getByRole("alert")).toContainText(failure === "malformed" ? "invalid" : "Unavailable")
		const requests = backend.requests.filter(request => request.path.startsWith("/run/run-one")).length
		await page.clock.fastForward(30_000)
		expect(backend.requests.filter(request => request.path.startsWith("/run/run-one"))).toHaveLength(requests)
		await expect.poll(() => run.closed).toBe(run.streams.length)
	})
}

test("readiness recovers automatically while preserving mounted project state", async ({ desktop: { page }, backend }) => {
	await freezeTime(page)
	await backend.open()
	await page.getByRole("button", { name: "existing-project", exact: true }).click()
	await page.getByRole("textbox", { name: "Project name" }).fill("Keep this name")
	backend.handlers.set("GET /ready", response => json(response, { detail: "Offline" }, 503))
	await page.clock.fastForward(5001)
	await expect(page.locator(".backend-notice")).toContainText("Reconnecting automatically")
	backend.handlers.set("GET /ready", response => json(response, { status: "ready" }))
	await page.clock.fastForward(501)
	await expect(page.locator(".backend-notice")).toHaveCount(0)
	await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue("Keep this name")
	await expect(page.getByRole("button", { name: "existing-project", exact: true })).toHaveAttribute("aria-pressed", "true")
})
