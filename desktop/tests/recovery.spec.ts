import { expect, type Page } from "@playwright/test"
import { test, json, prepareRun, snapshot, message, emit, start, output, replyBox, runStatus, launchButton, expectOverview } from "./run-fixture"
import type { Backend } from "./selection-fixture"

const runReads = (backend: Backend, id = "run-one") => backend.requests.filter(request => request.path === `/run/${id}`).length
const creates = (backend: Backend) => backend.requests.filter(request => request.path === "/run/create").length
/** Reloading restarts the renderer with the profile's storage, as reopening the app does. */
const reopen = (page: Page) => page.reload()

test("reopening restores the shown run and the unsent draft without launching again", async ({ desktop: { page }, backend }) => {
	const run = prepareRun(backend)
	backend.handlers.set("GET /run/run-one", response => json(response, snapshot({ message_trace: [message(1, "Kept output")] })))
	await start(page, backend)
	await expect.poll(() => run.streams.length).toBe(1)
	emit(run.streams[0], message(1, "Kept output"))
	await replyBox(page).fill("Unsent draft")
	await reopen(page)
	await expect(output(page)).toHaveText("Kept output")
	await expect(replyBox(page)).toHaveValue("Unsent draft")
	await expect(runStatus(page)).toContainText("existing-project")
	await expect.poll(() => run.streams.length).toBe(2)
	expect(creates(backend)).toBe(1)
})

test("a run that ended is not reopened, but its draft is kept", async ({ desktop: { page }, backend }) => {
	prepareRun(backend)
	let current = snapshot()
	backend.handlers.set("GET /run/run-one", response => json(response, current))
	await page.clock.install()
	await start(page, backend)
	await replyBox(page).fill("Keep me")
	current = snapshot({ status: "completed" })
	await page.clock.fastForward(2001)
	await expectOverview(page)
	const reads = runReads(backend)
	await reopen(page)
	await expectOverview(page)
	expect(runReads(backend)).toBe(reads)
	prepareRun(backend, "run-two")
	await launchButton(page, "existing-project").click()
	await expect(replyBox(page)).toHaveValue("Keep me")
})

test("a saved run that has gone missing returns to the overview once, keeping the draft", async ({ desktop: { page }, backend }) => {
	prepareRun(backend)
	await start(page, backend)
	await replyBox(page).fill("Still mine")
	backend.handlers.set("GET /run/run-one", response => json(response, { detail: "unknown run_id" }, 404))
	backend.handlers.set("GET /run/run-one/stream", response => json(response, { detail: "unknown run_id" }, 404))
	await reopen(page)
	await expectOverview(page)
	const reads = runReads(backend)
	await reopen(page)
	await expectOverview(page)
	expect(runReads(backend)).toBe(reads)
	prepareRun(backend, "run-two")
	await launchButton(page, "existing-project").click()
	await expect(replyBox(page)).toHaveValue("Still mine")
})

test("an unreadable saved record is reported and the app starts fresh", async ({ desktop: { page }, backend }) => {
	await backend.open()
	await page.evaluate(() => {
		localStorage.setItem("robozium.desktop.recovery.v1.mock", "{not json")
		localStorage.setItem("robozium.desktop.recovery.v1.live", JSON.stringify({ version: 1, run: { id: "live-run", project: "live-project" }, draft: "Live draft" }))
	})
	await reopen(page)
	await expect(page.getByRole("alert")).toContainText("Saved recovery data could not be read. Your current draft is still editable.")
	await expectOverview(page)
	// Live and mock keep separate records; the mock app never opens the live run.
	expect(runReads(backend, "live-run")).toBe(0)
	prepareRun(backend)
	await launchButton(page, "existing-project").click()
	await expect(replyBox(page)).toHaveValue("")
})
