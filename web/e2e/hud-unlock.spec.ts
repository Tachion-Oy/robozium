import { expect, test } from "./fixtures"
import { credentialTableOffset, expectCredentialMenuLayout, waitForHudLayout } from "./hud-layout"

test("HUD unlocks encrypted keys after a failed attempt", async ({ page }) => {
	await page.route("**/api/credentials", (route) => route.fulfill({
		status: 200,
		contentType: "application/json",
		body: JSON.stringify({ available: true, locked: true, removable: false }),
	}))
	let attempts = 0
	await page.route("**/api/credentials/unlock", (route) => {
		attempts += 1
		const password = route.request().postDataJSON().password
		return route.fulfill({
			status: password === "test-password" ? 200 : 400,
			contentType: "application/json",
			body: JSON.stringify(password === "test-password"
				? { available: true, locked: false, removable: true }
				: { detail: "Could not unlock API keys" }),
		})
	})
	await page.goto("/")
	await page.getByRole("button", { name: "API keys locked" }).click()
	const password = page.getByLabel("API key password")
	await expect(password).toHaveAttribute("type", "password")
	await password.fill("wrong")
	await page.getByRole("button", { name: "Unlock", exact: true }).click()
	await expect(page.locator(".agent-hud__credential-menu [role='alert']")).toContainText("Could not unlock")
	await expect(password).toHaveValue("")
	await password.fill("test-password")
	await page.getByRole("button", { name: "Unlock", exact: true }).click()
	await expect(page.getByRole("button", { name: "API keys unlocked" })).toBeVisible()
	expect(attempts).toBe(2)
})

test("starting with locked keys shows the shared error toast", async ({ page }) => {
	await page.route("**/api/credentials", (route) => route.fulfill({
		status: 200,
		contentType: "application/json",
		body: JSON.stringify({ available: true, locked: true, removable: false }),
	}))
	await page.route("**/api/runs/create", (route) => route.fulfill({
		status: 423,
		contentType: "application/json",
		body: JSON.stringify({ detail: "Unlock API keys before using providers" }),
	}))
	await page.goto("/?from=app")
	await page.getByRole("button", { name: "New Project", exact: true }).click()
	await page.getByRole("textbox", { name: "Project name" }).fill("locked-test")
	await page.getByRole("form", { name: "Capability selector" }).getByRole("button", { name: "Launch", exact: true }).click()

	const toast = page.locator(".agent-error-toast.agent-error-toast--error")
	await expect(toast).toBeVisible()
	await expect(toast.locator(".agent-error-toast__title")).toHaveText("API keys locked")
	await expect(toast.locator(".agent-error-toast__message")).toHaveText("Unlock API keys before starting a run.")
	await expect(toast.getByRole("button", { name: "Dismiss error notification" })).toBeVisible()
	expect(new URL(page.url()).searchParams.has("error")).toBe(false)
})

test("unlock request reaches the API through the web proxy", async ({ page }) => {
	await page.goto("/?from=app")
	const result = await page.evaluate(async () => {
		const response = await fetch("/api/credentials/unlock", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ password: "synthetic" }),
		})
		return { status: response.status, body: await response.json() }
	})
	expect(result.status).toBe(404)
	expect(result.body).toEqual({ detail: "Encrypted API keys are unavailable" })
	const cleared = await page.request.post("/api/credentials/clear")
	expect(cleared.status()).toBe(200)
	expect(await cleared.json()).toEqual({ available: false, locked: false, removable: false })
})

test("credential menu uses the red selector treatment in both themes", async ({ page }) => {
	// Measure the menu against a settled HUD, not the fresh landing entrance.
	await page.emulateMedia({ reducedMotion: "reduce" })
	let locked = true
	await page.route("**/api/credentials", (route) => route.fulfill({
		status: 200,
		contentType: "application/json",
		body: JSON.stringify({ available: true, locked, removable: !locked }),
	}))
	for (const state of ["locked", "unlocked"] as const) {
		locked = state === "locked"
		await page.goto("/?from=app")
		await expect(page.getByRole("button", { name: `API keys ${state}` })).toBeVisible()
		await expect(page.locator(".agent-hud__table-scroll")).toBeVisible()
		const tableOffsetByTheme = { dark: 0, light: 0 }
		for (const theme of ["dark", "light"] as const) {
			await page.evaluate((value) => { document.documentElement.dataset.theme = value }, theme)
			tableOffsetByTheme[theme] = await credentialTableOffset(page)
			const closed = await page.evaluate(() => {
				const trigger = document.querySelector(".agent-hud__credential-selector .agent-hud__model-trigger")
				const table = document.querySelector(".agent-hud__table-scroll")
				return {
					gap: trigger && table ? table.getBoundingClientRect().top - trigger.getBoundingClientRect().bottom : 0,
				}
			})
			if (theme === "dark") expect(closed.gap).toBeGreaterThanOrEqual(40)
			await page.screenshot({ path: test.info().outputPath(`credential-${state}-closed-${theme}.png`), animations: "disabled" })
		}
		await page.getByRole("button", { name: `API keys ${state}` }).click()
		for (const theme of ["dark", "light"] as const) {
			await page.evaluate((value) => { document.documentElement.dataset.theme = value }, theme)
			const selector = page.locator(".agent-hud__credential-selector")
			await expect(selector).toBeVisible()
			await expectCredentialMenuLayout(page, tableOffsetByTheme[theme])
			const accent = await selector.evaluate((element) => getComputedStyle(element).getPropertyValue("--selector-accent").trim())
			const red = await page.locator("html").evaluate((element) => getComputedStyle(element).getPropertyValue("--term-red").trim())
			expect(accent).toBe(red)
			const menuStyle = await page.evaluate(() => {
				const trigger = document.querySelector<HTMLElement>(".agent-hud__credential-selector .agent-hud__model-trigger")
				const menu = document.querySelector<HTMLElement>(".agent-hud__credential-menu")
				const action = menu?.querySelector<HTMLElement>(".agent-hud__model-option")
				const input = menu?.querySelector<HTMLInputElement>("input")
				return {
					triggerFont: trigger ? getComputedStyle(trigger).fontFamily : "",
					actionFont: action ? getComputedStyle(action).fontFamily : "",
					inputFont: input ? getComputedStyle(input).fontFamily : null,
				}
			})
			expect(menuStyle.actionFont).toBe(menuStyle.triggerFont)
			if (state === "locked") expect(menuStyle.inputFont).toBe(menuStyle.triggerFont)
			await page.screenshot({ path: test.info().outputPath(`credential-${state}-${theme}.png`), animations: "disabled" })
		}
	}
})

test("unlocks a synthetic encrypted file through the real API", async ({ page }) => {
	if (process.env.ROBOZIUM_E2E_TEST_ENCRYPTED !== "1") {
		test.info().annotations.push({ type: "expected-skip", description: "requires a synthetic encrypted file" })
		test.skip(true, "requires a synthetic encrypted file")
	}
	test.setTimeout(60_000)
	await page.goto("/?from=app")
	await page.getByRole("button", { name: "API keys locked" }).click()
	const password = page.getByLabel("API key password")
	await password.fill("wrong")
	await page.getByRole("button", { name: "Unlock", exact: true }).click()
	await expect(page.locator(".agent-hud__credential-menu [role='alert']")).toBeVisible()
	await password.fill("synthetic-password")
	await page.getByRole("button", { name: "Unlock", exact: true }).click()
	await expect(page.getByRole("button", { name: "API keys unlocked" })).toBeVisible({ timeout: 40_000 })
	const status = await page.request.get("/api/credentials")
	expect(await status.json()).toEqual({ available: true, locked: false, removable: true })
	await page.getByRole("button", { name: "API keys unlocked" }).click()
	await page.getByRole("button", { name: "Remove API keys" }).click()
	await expect(page.getByRole("button", { name: "API keys locked" })).toBeVisible()
	expect((await (await page.request.get("/api/credentials")).json()).locked).toBe(true)
})

test("credential geometry waits for delayed HUD hydration", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" })
	await page.route("**/api/credentials", (route) => route.fulfill({
		json: { available: true, locked: true, removable: false },
	}))
	await page.goto("/?from=app")
	const offset = await credentialTableOffset(page)
	await page.getByRole("button", { name: "API keys locked" }).click()
	await page.evaluate(() => {
		const hud = document.querySelector<HTMLElement>(".agent-hud__box")!
		const width = hud.style.width
		hud.style.width = ""
		setTimeout(() => { hud.style.width = width }, 600)
	})
	await expectCredentialMenuLayout(page, offset)
})

for (const defect of ["overlap", "clipping", "missing content", "unreachable control"] as const) {
	test(`credential geometry rejects ${defect}`, async ({ page }) => {
		await page.emulateMedia({ reducedMotion: "reduce" })
		await page.route("**/api/credentials", (route) => route.fulfill({
			json: { available: true, locked: true, removable: false },
		}))
		await page.goto("/?from=app")
		const offset = await credentialTableOffset(page)
		await page.getByRole("button", { name: "API keys locked" }).click()
		await waitForHudLayout(page, [".agent-hud__credential-menu"])
		await page.evaluate((defect) => {
			const menu = document.querySelector<HTMLElement>(".agent-hud__credential-menu")!
			if (defect === "overlap") menu.style.transform = "translateY(100px)"
			if (defect === "clipping") menu.style.transform = "translateX(2000px)"
			if (defect === "missing content") menu.querySelector("button")!.remove()
			if (defect === "unreachable control") menu.querySelector<HTMLElement>("button")!.style.pointerEvents = "none"
		}, defect)
		await expect(expectCredentialMenuLayout(page, offset, 2_000)).rejects.toThrow()
	})
}
