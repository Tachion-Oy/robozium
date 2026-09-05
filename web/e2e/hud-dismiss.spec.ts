import { expect, test, type Page } from "@playwright/test"
import { AgentActivityState } from "../lib/robosprawl/session/reducer"
import { gotoLanding, selectHudView } from "./helpers"

test.describe.configure({ mode: "serial" })

async function startRunFromLanding(
	page: Page,
	projectName: string,
): Promise<string> {
	await gotoLanding(page)

	const startButton = page.locator("button.agent-hud__start")
	await expect(startButton).toBeVisible()
	await startButton.click()

	const projectInput = page.getByLabel("Project name")
	await expect(projectInput).toBeVisible()
	await projectInput.fill(projectName)
	const createButton = page.getByRole("button", { name: "Create Project" })
	await expect(createButton).toBeEnabled()
	await createButton.evaluate((button: HTMLButtonElement) =>
		button.form?.requestSubmit(),
	)
	await expect(page).toHaveURL(/[?&]runId=/, { timeout: 20_000 })
	const runId = new URL(page.url()).searchParams.get("runId")

	expect(runId).toBeTruthy()
	return runId as string
}

test("HUD closes through Minimize or Escape and reopens via the minimized widget", async ({
	page,
}) => {
	const runId = await startRunFromLanding(page, "hud-dismiss-e2e")
	const hud = page.locator(".agent-hud")
	const mini = page.locator(".agent-hud__mini")
	const miniLogo = page.locator(".agent-hud__logo--mini")
	const expand = page.locator(".agent-hud__mini-expand")

	// The composer appears immediately; the indicator is authoritative for the
	// transition to a replyable prompt.
	await expect(miniLogo).toHaveAttribute("data-agent-state", AgentActivityState.AwaitingInput, {
		timeout: 15_000,
	})
	await expect(hud).not.toHaveClass(/agent-hud--hidden/)
	const viewTrigger = page.locator(".agent-hud__view-trigger")
	await expect(viewTrigger).toHaveText("Current Run")
	const runUrl = page.url()
	await selectHudView(page, "Dependencies")
	await expect(viewTrigger).toHaveText("Dependencies")
	expect(page.url()).toBe(runUrl)
	await selectHudView(page, "Current Run")
	await expect(page.locator(".agent-hud__textarea")).toBeVisible()
	// Open HUD: the widget is hidden but retains the awaiting-input state.
	await expect(mini).toHaveClass(/agent-hud__mini--hidden/)
	await expect(miniLogo).toHaveAttribute("data-agent-state", AgentActivityState.AwaitingInput)

	// Backdrop clicks are intentionally inert; only the explicit control and
	// Escape communicate dismissal intent.
	await page.mouse.click(10, page.viewportSize()!.height - 10)
	await expect(hud).not.toHaveClass(/agent-hud--hidden/)
	await page.getByRole("button", { name: "Minimize" }).click()
	await expect(hud).toHaveClass(/agent-hud--hidden/)
	await expect(viewTrigger).toHaveCount(0)
	// Widget appears with the same awaiting-input indicator state.
	await expect(mini).not.toHaveClass(/agent-hud__mini--hidden/)
	await expect(miniLogo).toHaveAttribute("data-agent-state", AgentActivityState.AwaitingInput)
	const miniPanel = page.locator(".agent-hud__mini-box")
	// The visibility class changes before the scale transition finishes. Measure
	// final geometry only after the widget reaches its full size on every browser.
	await expect(miniPanel).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)")
	const miniBox = await miniPanel.boundingBox()
	const expandBox = await expand.boundingBox()
	const messageContent = await page.locator(".term-msg-content").first().boundingBox()
	expect(miniBox).not.toBeNull()
	expect(expandBox).not.toBeNull()
	expect(messageContent).not.toBeNull()
	if (miniBox && expandBox && messageContent) {
		expect(Math.abs(miniBox.width - miniBox.height)).toBeLessThan(1)
		expect(expandBox.x - miniBox.x).toBeGreaterThanOrEqual(10)
		expect(
			miniBox.x + miniBox.width - (expandBox.x + expandBox.width),
		).toBeGreaterThanOrEqual(10)
		expect(miniBox.x + miniBox.width).toBeLessThanOrEqual(messageContent.x)
		expect(
			Math.abs(
				miniBox.y + miniBox.height / 2 - page.viewportSize()!.height / 2,
			),
		).toBeLessThan(2)
	}

	// The widget's expand button reopens the HUD.
	await expand.click()
	await expect(hud).not.toHaveClass(/agent-hud--hidden/)
	await expect(viewTrigger).toBeVisible()
	await expect(mini).toHaveClass(/agent-hud__mini--hidden/)
	await expect(miniLogo).toHaveAttribute("data-agent-state", AgentActivityState.AwaitingInput)
	expect(new URL(page.url()).searchParams.get("runId")).toBe(runId)

	// Escape also closes.
	await page.keyboard.press("Escape")
	await expect(hud).toHaveClass(/agent-hud--hidden/)

	await expand.click()
	await expect(hud).not.toHaveClass(/agent-hud--hidden/)

	// Active runs no longer expose application navigation back to landing.
	await expect(page.locator(".app-nav__brand")).toHaveCount(0)
	expect(new URL(page.url()).searchParams.get("runId")).toBe(runId)
})

test("HUD entered via the fresh-load intro still hides visually on dismiss", async ({
	page,
}) => {
	// Fresh load without ?from=app plays the intro, whose finished fill-mode:both
	// animation used to hold opacity at animation priority and defeat the hidden
	// class — so assert computed styles, not class names.
	await page.goto("/")
	await expect(
		page.getByRole("button", { name: "New Project", exact: true }),
	).toBeVisible({ timeout: 30_000 })
	await page.locator("button.agent-hud__start").click()
	await page.getByLabel("Project name").fill(`hud-intro-e2e-${Date.now()}`)
	await page
		.getByRole("button", { name: "Create Project" })
		.evaluate((button: HTMLButtonElement) => button.form?.requestSubmit())
	await expect(page).toHaveURL(/[?&]runId=/, { timeout: 20_000 })
	await expect(page.locator(".agent-hud__textarea")).toBeVisible({
		timeout: 15_000,
	})

	const box = page.locator(".agent-hud__box")
	await page.getByRole("button", { name: "Minimize" }).click()
	await expect(box).toHaveCSS("opacity", "0")
	await expect(page.locator(".agent-hud")).toHaveCSS(
		"background-color",
		"rgba(0, 0, 0, 0)",
	)

	await page.locator(".agent-hud__mini-expand").click()
	await expect(box).toHaveCSS("opacity", "1")
})
