import { expect, test } from "@playwright/test"

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
	let locked = true
	await page.route("**/api/credentials", (route) => route.fulfill({
		status: 200,
		contentType: "application/json",
		body: JSON.stringify({ available: true, locked, removable: !locked }),
	}))
	for (const state of ["locked", "unlocked"] as const) {
		locked = state === "locked"
		await page.goto("/")
		await expect(page.getByRole("button", { name: `API keys ${state}` })).toBeVisible()
		await expect(page.locator(".agent-hud__table-scroll")).toBeVisible()
		const tableTopByTheme = { dark: 0, light: 0 }
		for (const theme of ["dark", "light"] as const) {
			await page.evaluate((value) => { document.documentElement.dataset.theme = value }, theme)
			const closed = await page.evaluate(() => {
				const trigger = document.querySelector(".agent-hud__credential-selector .agent-hud__model-trigger")
				const table = document.querySelector(".agent-hud__table-scroll")
				return {
					gap: trigger && table ? table.getBoundingClientRect().top - trigger.getBoundingClientRect().bottom : 0,
					tableTop: table?.getBoundingClientRect().top ?? 0,
				}
			})
			tableTopByTheme[theme] = closed.tableTop
			if (theme === "dark") expect(closed.gap).toBeGreaterThanOrEqual(40)
			await page.screenshot({ path: test.info().outputPath(`credential-${state}-closed-${theme}.png`), animations: "disabled" })
		}
		await page.getByRole("button", { name: `API keys ${state}` }).click()
		for (const theme of ["dark", "light"] as const) {
			await page.evaluate((value) => { document.documentElement.dataset.theme = value }, theme)
			const selector = page.locator(".agent-hud__credential-selector")
			await expect(selector).toBeVisible()
			await expect(page.getByRole("dialog", { name: "API keys" })).toBeVisible()
			const labelFits = await selector.locator(".agent-hud__model-trigger > span").evaluate(
				(element) => element.scrollWidth <= element.clientWidth,
			)
			expect(labelFits).toBe(true)
			const accent = await selector.evaluate((element) => getComputedStyle(element).getPropertyValue("--selector-accent").trim())
			const red = await page.locator("html").evaluate((element) => getComputedStyle(element).getPropertyValue("--term-red").trim())
			expect(accent).toBe(red)
			const menuStyle = await page.evaluate(() => {
				const trigger = document.querySelector<HTMLElement>(".agent-hud__credential-selector .agent-hud__model-trigger")
				const menu = document.querySelector<HTMLElement>(".agent-hud__credential-menu")
				const table = document.querySelector<HTMLElement>(".agent-hud__table-scroll")
				const action = menu?.querySelector<HTMLElement>(".agent-hud__model-option")
				const input = menu?.querySelector<HTMLInputElement>("input")
				return {
					gap: menu && table ? table.getBoundingClientRect().top - menu.getBoundingClientRect().bottom : 0,
					tableTop: table?.getBoundingClientRect().top ?? 0,
					triggerFont: trigger ? getComputedStyle(trigger).fontFamily : "",
					actionFont: action ? getComputedStyle(action).fontFamily : "",
					inputFont: input ? getComputedStyle(input).fontFamily : null,
				}
			})
			expect(Math.abs(menuStyle.tableTop - tableTopByTheme[theme])).toBeLessThanOrEqual(1)
			if (theme === "dark") expect(menuStyle.gap).toBeGreaterThanOrEqual(0)
			expect(menuStyle.actionFont).toBe(menuStyle.triggerFont)
			if (state === "locked") expect(menuStyle.inputFont).toBe(menuStyle.triggerFont)
			await page.screenshot({ path: test.info().outputPath(`credential-${state}-${theme}.png`), animations: "disabled" })
		}
	}
})

test("unlocks a synthetic encrypted file through the real API", async ({ page }) => {
	test.skip(process.env.ROBOZIUM_E2E_TEST_ENCRYPTED !== "1", "requires a synthetic encrypted file")
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
