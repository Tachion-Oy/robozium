import { expect, type Page } from "@playwright/test"
import type { ServerResponse } from "node:http"
import { test, json, prepareRun, snapshot, start, replyBox, launchButton } from "./run-fixture"
import type { Backend } from "./selection-fixture"

const locked = { available: true, locked: true, restart_required: false }
const unlocked = { available: true, locked: false, restart_required: false }
const dialog = (page: Page) => page.getByRole("dialog", { name: "Unlock secrets" })
const password = (page: Page) => dialog(page).getByLabel("Password")
const writes = (backend: Backend, path: string) => backend.requests.filter(request => request.method === "POST" && request.path === path)
const lockedAlert = (page: Page) => page.getByRole("alert").filter({ hasText: "Secrets locked" })

test("no password is asked for without locked secrets, and the header has no secrets menu", async ({ desktop: { page }, backend }) => {
	backend.handlers.set("GET /credentials", response => json(response, unlocked))
	prepareRun(backend)
	await backend.open()
	await expect.poll(() => backend.requests.filter(request => request.path === "/credentials").length).toBeGreaterThan(0)
	await launchButton(page, "existing-project").click()
	await expect(page.getByRole("status", { name: "Run status" })).toContainText("existing-project")
	await expect(dialog(page)).toHaveCount(0)
	await expect(page.getByRole("button", { name: /^Secrets/ })).toHaveCount(0)
})

test("locked secrets ask for the password over Runs Overview, and a wrong one keeps the dialog open", async ({ desktop: { page }, backend }) => {
	let status = locked
	backend.handlers.set("GET /credentials", response => json(response, status))
	backend.handlers.set("POST /credentials/unlock", (response, body) => {
		if ((body as { password: string }).password !== "correct horse") return json(response, { detail: "Could not unlock secrets" }, 400)
		status = unlocked
		json(response, status)
	})
	prepareRun(backend)
	await backend.open()
	await expect(dialog(page)).toBeVisible()
	await expect(password(page)).toBeFocused()
	await expect(dialog(page).getByRole("button", { name: "Unlock" })).toBeDisabled()
	await password(page).fill("wrong")
	await password(page).press("Enter")
	await expect(dialog(page).getByRole("alert")).toHaveText("Could not unlock secrets. Check the password and try again.")
	await expect(password(page)).toHaveValue("")
	await password(page).fill("correct horse")
	await dialog(page).getByRole("button", { name: "Unlock" }).click()
	await expect(dialog(page)).toHaveCount(0)
	expect(writes(backend, "/credentials/unlock").map(request => request.body)).toEqual([{ password: "wrong" }, { password: "correct horse" }])
	// Once unlocked, a launch goes ahead without asking again.
	await launchButton(page, "existing-project").click()
	await expect(page.getByRole("status", { name: "Run status" })).toContainText("existing-project")
})

test("a pending unlock ignores Escape, and Escape cancels afterwards", async ({ desktop: { page }, backend }) => {
	backend.handlers.set("GET /credentials", response => json(response, locked))
	let pending: ServerResponse | undefined
	backend.handlers.set("POST /credentials/unlock", response => { pending = response })
	await backend.open()
	await password(page).fill("secret")
	await password(page).press("Enter")
	await expect(dialog(page).getByRole("button", { name: "Unlocking…" })).toBeDisabled()
	// The waiting button pulses until the outcome arrives.
	await expect(dialog(page).getByRole("button", { name: "Unlocking…" })).toHaveAttribute("aria-busy", "true")
	await page.keyboard.press("Escape")
	await expect(dialog(page)).toBeVisible()
	json(pending!, { detail: "Could not unlock secrets" }, 400)
	await expect(dialog(page).getByRole("alert")).toBeVisible()
	await page.keyboard.press("Escape")
	await expect(dialog(page)).toHaveCount(0)
	await expect(launchButton(page, "existing-project")).toBeEnabled()
	expect(writes(backend, "/credentials/unlock")).toHaveLength(1)
})

test("a launch while locked asks again: cancelling reports it, unlocking launches", async ({ desktop: { page }, backend }) => {
	let status = locked
	backend.handlers.set("GET /credentials", response => json(response, status))
	backend.handlers.set("POST /credentials/unlock", response => { status = unlocked; json(response, status) })
	prepareRun(backend)
	await backend.open()
	await dialog(page).getByRole("button", { name: "Cancel" }).click()
	await expect(dialog(page)).toHaveCount(0)
	await launchButton(page, "existing-project").click()
	await expect(dialog(page)).toBeVisible()
	await dialog(page).getByRole("button", { name: "Cancel" }).click()
	await expect(lockedAlert(page)).toContainText("Unlock secrets before starting a run.")
	expect(writes(backend, "/run/create")).toHaveLength(0)
	await launchButton(page, "existing-project").click()
	await password(page).fill("correct horse")
	await password(page).press("Enter")
	await expect(page.getByRole("status", { name: "Run status" })).toContainText("existing-project")
	expect(writes(backend, "/run/create")).toHaveLength(1)
})

test("a reply while locked asks for the password and keeps the draft when cancelled", async ({ desktop: { page }, backend }) => {
	let status = unlocked
	backend.handlers.set("GET /credentials", response => json(response, status))
	prepareRun(backend)
	backend.handlers.set("GET /run/run-one", response => json(response, snapshot({ status: "awaiting_user_input", current_prompt_id: "p1", current_prompt: "Question" })))
	await start(page, backend)
	// Secrets were locked elsewhere; the backend now refuses provider work.
	status = locked
	backend.handlers.set("POST /run/run-one/reply", response => json(response, { detail: "Unlock secrets before using providers" }, 423))
	await replyBox(page).fill("Answer")
	await replyBox(page).press("Enter")
	await expect(dialog(page)).toBeVisible()
	await dialog(page).getByRole("button", { name: "Cancel" }).click()
	await expect(lockedAlert(page)).toContainText("Unlock secrets before replying. Your draft has been kept.")
	await expect(replyBox(page)).toHaveValue("Answer")
	expect(writes(backend, "/run/run-one/reply")).toHaveLength(1)
	// The status was read again, so the next reply asks before sending.
	await replyBox(page).press("Enter")
	await expect(dialog(page)).toBeVisible()
	await dialog(page).getByRole("button", { name: "Cancel" }).click()
	expect(writes(backend, "/run/run-one/reply")).toHaveLength(1)
})

test("a launch refused as locked asks for the password without repeating the launch", async ({ desktop: { page }, backend }) => {
	let status = unlocked
	backend.handlers.set("GET /credentials", response => json(response, status))
	backend.handlers.set("POST /credentials/unlock", response => { status = unlocked; json(response, status) })
	backend.handlers.set("POST /run/create", response => { status = locked; json(response, { detail: "Unlock secrets before using providers" }, 423) })
	await backend.open()
	await launchButton(page, "existing-project").click()
	await expect(dialog(page)).toBeVisible()
	await password(page).fill("correct horse")
	await password(page).press("Enter")
	await expect(dialog(page)).toHaveCount(0)
	await expect(lockedAlert(page)).toHaveCount(0)
	expect(writes(backend, "/run/create")).toHaveLength(1)
})
