import { expect, type Page } from "@playwright/test"
import type { ServerResponse } from "node:http"
import { test, json, prepareRun, snapshot, start, replyBox, launchButton } from "./run-fixture"
import type { Backend } from "./selection-fixture"

const locked = { available: true, locked: true, removable: false }
const unlocked = { available: true, locked: false, removable: true }
const trigger = (page: Page) => page.getByRole("button", { name: /^Secrets (locked|unlocked)$/ })
const menu = (page: Page) => page.getByRole("dialog", { name: "Secrets" })
const password = (page: Page) => menu(page).getByLabel("Secret password")
const writes = (backend: Backend, path: string) => backend.requests.filter(request => request.method === "POST" && request.path === path)

test("the menu stays hidden while the backend has no encrypted secrets", async ({ desktop: { page }, backend }) => {
	backend.handlers.set("GET /credentials", response => json(response, { available: false, locked: false, removable: false }))
	await backend.open()
	await expect.poll(() => backend.requests.filter(request => request.path === "/credentials").length).toBeGreaterThan(0)
	await expect(trigger(page)).toHaveCount(0)
})

test("unlocking sends the password once, and a wrong one keeps the menu open", async ({ desktop: { page }, backend }) => {
	let status = locked
	backend.handlers.set("GET /credentials", response => json(response, status))
	backend.handlers.set("POST /credentials/unlock", (response, body) => {
		if ((body as { password: string }).password !== "correct horse") return json(response, { detail: "Could not unlock secrets" }, 400)
		status = unlocked
		json(response, status)
	})
	await backend.open()
	await expect(trigger(page)).toHaveText("Secrets locked")
	await trigger(page).click()
	await expect(password(page)).toBeFocused()
	await expect(menu(page).getByRole("button", { name: "Unlock" })).toBeDisabled()
	await password(page).fill("wrong")
	await password(page).press("Enter")
	await expect(menu(page).getByRole("alert")).toHaveText("Could not unlock secrets. Check the password and try again.")
	await expect(password(page)).toHaveValue("")
	await password(page).fill("correct horse")
	await menu(page).getByRole("button", { name: "Unlock" }).click()
	await expect(menu(page)).toHaveCount(0)
	await expect(trigger(page)).toHaveText("Secrets unlocked")
	expect(writes(backend, "/credentials/unlock").map(request => request.body)).toEqual([{ password: "wrong" }, { password: "correct horse" }])
})

test("a pending unlock locks the menu, and Escape or an outside click close it afterwards", async ({ desktop: { page }, backend }) => {
	backend.handlers.set("GET /credentials", response => json(response, locked))
	let pending: ServerResponse | undefined
	backend.handlers.set("POST /credentials/unlock", response => { pending = response })
	await backend.open()
	await trigger(page).click()
	await password(page).fill("secret")
	await password(page).press("Enter")
	await expect(menu(page).getByRole("button", { name: "Unlocking…" })).toBeDisabled()
	await page.keyboard.press("Escape")
	await expect(menu(page)).toBeVisible()
	json(pending!, { detail: "Could not unlock secrets" }, 400)
	await expect(menu(page).getByRole("alert")).toBeVisible()
	await page.keyboard.press("Escape")
	await expect(menu(page)).toHaveCount(0)
	await expect(trigger(page)).toBeFocused()
	await trigger(page).click()
	await page.mouse.click(5, 5)
	await expect(menu(page)).toHaveCount(0)
	expect(writes(backend, "/credentials/unlock")).toHaveLength(1)
})

test("Remove secrets locks them again, and a failure is reported", async ({ desktop: { page }, backend }) => {
	let status = unlocked
	backend.handlers.set("GET /credentials", response => json(response, status))
	backend.handlers.set("POST /credentials/clear", response => json(response, { detail: "Busy" }, 503))
	await backend.open()
	await trigger(page).click()
	await menu(page).getByRole("button", { name: "Remove secrets" }).click()
	await expect(menu(page).getByRole("alert")).toHaveText("Could not remove secrets. Try again.")
	backend.handlers.set("POST /credentials/clear", response => { status = locked; json(response, status) })
	await menu(page).getByRole("button", { name: "Remove secrets" }).click()
	await expect(trigger(page)).toHaveText("Secrets locked")
	expect(writes(backend, "/credentials/clear")).toHaveLength(2)
})

test("a locked launch or reply points to the Secrets menu and reads its status again", async ({ desktop: { page }, backend }) => {
	let status = unlocked
	backend.handlers.set("GET /credentials", response => json(response, status))
	prepareRun(backend)
	backend.handlers.set("GET /run/run-one", response => json(response, snapshot({ status: "awaiting_user_input", current_prompt_id: "p1", current_prompt: "Question" })))
	await start(page, backend)
	await expect(trigger(page)).toHaveText("Secrets unlocked")
	// Secrets were removed elsewhere; the backend now refuses provider work.
	status = locked
	backend.handlers.set("POST /run/run-one/reply", response => json(response, { detail: "Unlock secrets before using providers" }, 423))
	await replyBox(page).fill("Answer")
	await replyBox(page).press("Enter")
	await expect(page.getByRole("alert").filter({ hasText: "Secrets locked" }).locator("p"))
		.toHaveText(["Secrets locked", "Unlock secrets before replying. Your draft has been kept.", "Open the Secrets locked menu and enter your password."])
	await expect(trigger(page)).toHaveText("Secrets locked")
	await expect(replyBox(page)).toHaveValue("Answer")
	expect(writes(backend, "/run/run-one/reply")).toHaveLength(1)
})

test("a locked launch reads the status again so the header shows Secrets locked", async ({ desktop: { page }, backend }) => {
	let status = unlocked
	backend.handlers.set("GET /credentials", response => json(response, status))
	backend.handlers.set("POST /run/create", response => { status = locked; json(response, { detail: "Unlock secrets before using providers" }, 423) })
	await backend.open()
	await expect(trigger(page)).toHaveText("Secrets unlocked")
	await launchButton(page, "existing-project").click()
	await expect(page.getByRole("alert").filter({ hasText: "Secrets locked" })).toContainText("Open the Secrets locked menu")
	await expect(trigger(page)).toHaveText("Secrets locked")
})
