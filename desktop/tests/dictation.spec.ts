import { expect, type Page } from "@playwright/test"
import type { ServerResponse } from "node:http"
import { documentUrl, preload } from "./native"
import { test, json, prepareRun, snapshot, start, replyBox } from "./run-fixture"

// A fake device gives the permitted microphone a signal under Xvfb.
test.use({ launchSwitches: ["--use-fake-device-for-media-stream"] })

const record = (page: Page) => page.locator(".agent-hud__dictate")
const waiting = () => snapshot({ status: "awaiting_user_input", current_prompt_id: "p1", current_prompt: "Question p1" })

test("Record dictates into the draft: recording, transcribing, then the text joins the draft", async ({ desktop: { page }, backend }) => {
	prepareRun(backend)
	backend.handlers.set("GET /run/run-one", response => json(response, waiting()))
	let pending: ServerResponse | undefined
	let upload = ""
	backend.handlers.set("POST /transcribe", (response, body) => {
		upload = String(body)
		pending = response
	})
	await start(page, backend)
	await replyBox(page).fill("Draft ")
	await expect(record(page)).toBeEnabled()
	await record(page).click()
	await expect(record(page)).toHaveAttribute("aria-pressed", "true")
	await expect(record(page)).toHaveAccessibleName("Stop")
	const meter = page.locator(".agent-hud__dictate-meter")
	await expect(meter).toBeVisible()
	// Every segment has room to show, and the fake device's beeps light some up.
	expect(await meter.locator(".agent-hud__dictate-meter-segment").evaluateAll(segments =>
		segments.map(segment => segment.getBoundingClientRect().width > 0))).toEqual(Array(6).fill(true))
	expect(await meter.evaluate(element => new Promise<boolean>(resolve => {
		const lit = new MutationObserver(() => {
			if (!element.querySelector("[data-active]")) return
			lit.disconnect()
			resolve(true)
		})
		lit.observe(element, { subtree: true, attributes: true })
		setTimeout(() => resolve(false), 4000)
	}))).toBe(true)
	// Let the recorder deliver audio before stopping.
	await page.waitForTimeout(500)
	await record(page).click()
	await expect(record(page)).toHaveAccessibleName("Transcribing voice input")
	await expect(record(page)).toBeDisabled()
	await expect.poll(() => pending).toBeDefined()
	expect(upload).toContain('filename="recording.webm"')
	expect(upload).toMatch(/Content-Type: audio\/webm/)
	json(pending!, { text: " dictated words " })
	await expect(replyBox(page)).toHaveValue("Draft dictated words")
	await expect(record(page)).toHaveAccessibleName("Record")
	await expect(record(page)).toBeEnabled()
})

test("a missing key is a notice, a provider failure an error, and both keep the draft", async ({ desktop: { page }, backend }) => {
	prepareRun(backend)
	backend.handlers.set("GET /run/run-one", response => json(response, waiting()))
	const detail = "Dictation needs an API key for groq. Add it under Environment, then record again."
	backend.handlers.set("POST /transcribe", response => json(response, { detail }, 409))
	await start(page, backend)
	await replyBox(page).fill("Keep me")
	await record(page).click()
	await expect(record(page)).toHaveAttribute("aria-pressed", "true")
	await page.waitForTimeout(500)
	await record(page).click()
	const notice = page.getByRole("status").filter({ hasText: "Dictation unavailable" })
	await expect(notice).toContainText(detail)
	await expect(notice).not.toContainText("API request failed")
	await expect(page.getByRole("alert")).toHaveCount(0)
	await notice.getByRole("button", { name: "Dismiss info notification" }).click()

	backend.handlers.set("POST /transcribe", response => json(response, { detail: "transcription failed" }, 502))
	await record(page).click()
	await expect(record(page)).toHaveAttribute("aria-pressed", "true")
	await page.waitForTimeout(500)
	await record(page).click()
	await expect(page.getByRole("alert").filter({ hasText: "Transcription failed" }))
		.toContainText("API request failed (502): transcription failed")
	await expect(replyBox(page)).toHaveValue("Keep me")
	await expect(record(page)).toBeEnabled()
})

test("only the app's own document may use the microphone, and only for audio", async ({ desktop: { app, page } }) => {
	const media = (constraints: MediaStreamConstraints) => page.evaluate(async constraints => {
		try {
			const stream = await navigator.mediaDevices.getUserMedia(constraints)
			stream.getTracks().forEach(track => track.stop())
			return "allowed"
		} catch (error) {
			return (error as Error).name
		}
	}, constraints)
	expect(await media({ audio: true })).toBe("allowed")
	expect(await media({ video: true })).toBe("NotAllowedError")
	expect(await media({ audio: true, video: true })).toBe("NotAllowedError")
	expect(await page.evaluate(() => Notification.requestPermission())).toBe("denied")
	expect(await app.evaluate(async ({ BrowserWindow }, { documentUrl, preload }) => {
		const other = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false } })
		try {
			await other.loadURL(documentUrl)
			return await other.webContents.executeJavaScript(
				`navigator.mediaDevices.getUserMedia({ audio: true }).then(() => "allowed", error => error.name)`)
		} finally { other.destroy() }
	}, { documentUrl, preload })).toBe("NotAllowedError")
})
