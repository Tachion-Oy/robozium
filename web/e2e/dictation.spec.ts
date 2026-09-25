import { expect, test } from "@playwright/test"
import { createProject } from "./helpers"

test("dictation failures use a toast, preserve the draft and layout, and allow retry", async ({ page, request }) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, "mediaDevices", {
			value: { getUserMedia: async () => ({ getTracks: () => [] }) },
		})
		Object.defineProperty(window, "AudioContext", { value: undefined })
		Object.defineProperty(window, "MediaRecorder", {
			value: class {
				state = "inactive"
				mimeType = "audio/webm"
				ondataavailable?: (event: { data: Blob }) => void
				onstop?: () => void
				start() { this.state = "recording" }
				stop() {
					this.state = "inactive"
					this.ondataavailable?.({ data: new Blob(["mock audio"]) })
					this.onstop?.()
				}
			},
		})
	})
	const slug = await createProject(request, `Dictation ${Date.now()}`)
	const response = await request.post("/api/runs/create", { data: { project: slug } })
	expect(response.ok()).toBe(true)
	const { run_id: runId } = await response.json() as { run_id: string }
	await page.goto(`/?runId=${encodeURIComponent(runId)}`)
	const editor = page.locator(".agent-hud__textarea")
	await editor.fill("Keep my draft.")
	await expect(page.locator(".agent-hud__agent", {
		hasText: "Hello! I generated a text artifact for validation:",
	})).toBeVisible({ timeout: 15_000 })
	const hud = page.locator(".agent-hud__box")
	await expect(hud).toHaveAttribute("style", /width:/)
	await hud.evaluate((element) => Promise.all(
		element.getAnimations().map((animation) => animation.finished),
	))
	const before = await hud.boundingBox()
	const detail = "Voice transcription is not configured for this server."
	await page.route("**/api/transcribe", (route) => route.fulfill({
		status: 503,
		json: { detail },
	}))

	await page.getByRole("button", { name: "Record", exact: true }).click()
	await page.getByRole("button", { name: "Stop", exact: true }).click()
	const toast = page.locator(".agent-error-toast")
	await expect(toast).toContainText("Transcription failed")
	await expect(toast).toContainText(detail)
	await expect(hud.locator(".agent-hud__dictation-error")).toHaveCount(0)
	await expect(editor).toHaveValue("Keep my draft.")
	expect(await hud.boundingBox()).toEqual(before)
	await toast.getByRole("button", { name: "Dismiss error notification" }).click()

	// Retry against the isolated mock backend; no external provider is called.
	await page.unroute("**/api/transcribe")
	await page.getByRole("button", { name: "Record", exact: true }).click()
	await page.getByRole("button", { name: "Stop", exact: true }).click()
	await expect(editor).toHaveValue("Keep my draft. mock transcription")
	await expect(page.getByRole("button", { name: "Record", exact: true })).toBeEnabled()
})
