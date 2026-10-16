import { _electron, expect, type Page } from "@playwright/test"
import { once } from "node:events"
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { test, desktopRoot, launchArgs, documentUrl, preload, waitForPanelLayout, captureNative } from "./native"
import { expectFooterGeometry } from "./footer-geometry"

async function expectPanelGeometry(page: Page, layout: "top" | "equal" | "bottom") {
	await waitForPanelLayout(page)
	const geometry = await page.locator(".hud-panels").evaluate(container => {
		const panels = [...container.querySelectorAll<HTMLElement>(".hud-panel")]
		const bounds = panels.map(panel => panel.getBoundingClientRect())
		const content = panels.map(panel => panel.firstElementChild as HTMLElement)
		return {
			contained: bounds.every(rect => rect.x >= 0 && rect.y >= 0
				&& rect.right <= innerWidth && rect.bottom <= innerHeight),
			usable: content.every(element => element.clientHeight >= 32 && element.clientWidth > 0
				&& element.scrollWidth <= element.clientWidth),
			separated: bounds[0].bottom < bounds[1].top,
			heights: bounds.map(rect => rect.height),
			available: container.clientHeight,
			noOverflow: document.documentElement.scrollHeight === innerHeight
				&& document.documentElement.scrollWidth === innerWidth,
		}
	})
	expect(geometry).toMatchObject({ contained: true, usable: true, separated: true, noOverflow: true })
	const [agent, composer] = geometry.heights
	if (layout === "equal") expect(Math.abs(agent - composer)).toBeLessThan(2)
	else {
		const compact = layout === "top" ? composer : agent
		expect(compact).toBeLessThanOrEqual(geometry.available * 0.45 + 1)
		expect(layout === "top" ? agent : composer).toBeGreaterThan(compact)
	}
}

for (const theme of ["dark", "light"]) {
	test(`selectors keep header positions stable and shrink in ${theme}`, async ({ desktop: { app, page } }) => {
		if (theme === "light") await page.getByRole("button", { name: "Toggle color theme" }).click()
		await page.getByRole("button", { name: "Start run", exact: true }).click()
		await page.evaluate(async () => { await document.fonts.ready })
		const selectors = [
			{ label: "Base model", index: 0, names: ["Mock model", "Mock fast model", "Mock extended context model"] },
			{ label: "HUD view", index: 3, names: ["Runs Overview", "Dependencies", "Environment", "Current Run"] },
		]
		const bounds = () => page.locator("header button").evaluateAll(buttons => buttons.map(button => {
			const { x, width } = button.getBoundingClientRect()
			return { x, width }
		}))
		let fullWidths: number[] = []
		for (const [width, height, zoom] of [[1260, 780, 1], [640, 420, 1.25]]) {
			await app.evaluate(({ BrowserWindow }, { width, height, zoom }) => {
				const window = BrowserWindow.getAllWindows()[0]
				window.setContentSize(width, height)
				window.webContents.setZoomFactor(zoom)
			}, { width, height, zoom })
			await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([width / zoom, height / zoom])
			const initial = await bounds()
			if (width === 1260) fullWidths = initial.map(button => button.width)
			for (const { label, index, names } of selectors) {
				const selector = page.getByRole("combobox", { name: new RegExp(`^${label}:`) })
				if (width !== 1260) expect(initial[index].width).toBeLessThan(fullWidths[index])
				for (const name of names) {
					await selector.click()
					await page.getByRole("option", { name, exact: true }).click()
					await expect(selector).toHaveAccessibleName(`${label}: ${name}`)
					await expect(selector).toHaveAttribute("title", name)
					expect(await bounds()).toEqual(initial)
					if (width === 1260) expect(await selector.locator(".hud-header__label")
						.evaluate(label => label.scrollWidth <= label.clientWidth)).toBe(true)
				}
			}
		}
	})

	test(`divider buttons stay square with centered arrows in ${theme}`, async ({ desktop: { app, page } }) => {
		for (const zoom of [1, 1.25]) {
			await app.evaluate(({ BrowserWindow }, zoom) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(zoom), zoom)
			await page.reload()
			if (theme === "light") await page.getByRole("button", { name: "Toggle color theme" }).click()
			for (const state of ["idle", "top", "equal", "bottom"]) {
				if (state === "top") await page.getByRole("button", { name: "Start run", exact: true }).click()
				else if (state !== "idle") await page.getByRole("button", { name: "Move panel divider up" }).click()
				const geometry = await page.getByRole("group", { name: /^Panel divider:/ }).getByRole("button")
					.evaluateAll(buttons => buttons.map(button => {
						const rect = button.getBoundingClientRect()
						const arrow = button.querySelector("svg")!.getBoundingClientRect()
						return {
							squareError: Math.abs(rect.width - rect.height),
							xOffset: Math.abs(rect.x + rect.width / 2 - arrow.x - arrow.width / 2),
							yOffset: Math.abs(rect.y + rect.height / 2 - arrow.y - arrow.height / 2),
							contained: arrow.x > rect.x && arrow.y > rect.y && arrow.right < rect.right && arrow.bottom < rect.bottom,
						}
					}))
				for (const button of geometry) {
					expect(button.squareError).toBeLessThan(0.1)
					expect(button.xOffset).toBeLessThan(0.1)
					expect(button.yOffset).toBeLessThan(0.1)
					expect(button.contained).toBe(true)
				}
			}
		}
	})

	test(`panel divider interpolates and respects reduced motion in ${theme}`, async ({ desktop: { page } }) => {
		await page.emulateMedia({ reducedMotion: "no-preference" })
		if (theme === "light") await page.getByRole("button", { name: "Toggle color theme" }).click()
		await page.getByRole("button", { name: "Start run", exact: true }).click()
		const motion = await page.evaluate(async () => {
			const panels = document.querySelector(".hud-panels")!
			const agent = panels.firstElementChild!
			const before = agent.getBoundingClientRect().height
			const started = new Promise<void>(resolve => panels.addEventListener("transitionrun", () => resolve(), { once: true }))
			document.querySelector<HTMLButtonElement>('[aria-label="Move panel divider up"]')!.click()
			await started
			const animations = panels.getAnimations({ subtree: true })
			for (const animation of animations) { animation.pause(); animation.currentTime = 110 }
			const middle = agent.getBoundingClientRect().height
			const timing = animations.map(animation => ({
				property: (animation as CSSTransition).transitionProperty,
				duration: animation.effect!.getTiming().duration,
				easing: animation.effect!.getTiming().easing,
			}))
			for (const animation of animations) animation.finish()
			return { before, middle, after: agent.getBoundingClientRect().height, timing }
		})
		expect(motion.middle).toBeLessThan(motion.before)
		expect(motion.middle).toBeGreaterThan(motion.after)
		expect(motion.timing).toEqual(expect.arrayContaining([
			{ property: "flex-grow", duration: 220, easing: "ease" },
			{ property: "flex-basis", duration: 220, easing: "ease" },
		]))
		await expectPanelGeometry(page, "equal")
		await page.emulateMedia({ reducedMotion: "reduce" })
		await page.getByRole("button", { name: "Move panel divider down" }).click()
		expect(await page.locator(".hud-panels").evaluate(panels => panels.getAnimations({ subtree: true }).length)).toBe(0)
		await expectPanelGeometry(page, "top")
	})

	test(`mock run preserves editing and divider state in ${theme}`, async ({ desktop: { app, page } }) => {
		const requests: string[] = []
		page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()) })
		const toggle = page.getByRole("button", { name: "Toggle color theme" })
		const view = page.getByRole("combobox", { name: /^HUD view:/ })
		const up = page.getByRole("button", { name: "Move panel divider up" })
		const down = page.getByRole("button", { name: "Move panel divider down" })
		const reply = page.getByRole("textbox", { name: "Reply", exact: true })
		if (theme === "light") await toggle.click()
		await expect(up).toBeDisabled()
		await expect(down).toBeDisabled()
		await view.click()
		await expect(page.getByRole("option", { name: "Current Run", exact: true })).toHaveCount(0)
		await view.press("Escape")
		await page.getByRole("button", { name: "Start run", exact: true }).press("Enter")
		await expect(reply).toBeFocused()
		await expect(view).toHaveAccessibleName("HUD view: Current Run")
		await expect(page.getByRole("region", { name: "Agent message", exact: true })).toContainText("Mock run ready.")
		await reply.fill("First line")
		await reply.press("Enter")
		await reply.press("Shift+Enter")
		await reply.pressSequentially("Last line")
		const draft = "First line\n\nLast line"
		await expect(reply).toHaveValue(draft)
		const model = page.getByRole("combobox", { name: /^Base model:/ })
		await model.click()
		await page.getByRole("option", { name: "Mock fast model", exact: true }).click()
		await expect(reply).toHaveValue(draft)
		await reply.focus()
		await reply.evaluate((element: HTMLTextAreaElement) => { element.setSelectionRange(2, 6); Reflect.set(window, "originalEditor", element) })
		await app.evaluate(({ BrowserWindow }) => {
			const window = BrowserWindow.getAllWindows()[0]
			window.setContentSize(640, 420)
			window.focus()
			window.webContents.sendInputEvent({ type: "keyDown", keyCode: "+", modifiers: ["control"] })
			window.webContents.sendInputEvent({ type: "keyUp", keyCode: "+", modifiers: ["control"] })
		})
		await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomLevel())).toBeCloseTo(0.5)
		await expect(reply).toBeFocused()
		await toggle.click()
		await toggle.click()
		await up.click()
		await expect(up).toBeFocused()
		await expectPanelGeometry(page, "equal")
		await up.press("Space")
		await expect(up).toBeDisabled()
		await expect(down).toBeFocused()
		await expectPanelGeometry(page, "bottom")
		expect(await reply.evaluate((element: HTMLTextAreaElement) => [
			element === Reflect.get(window, "originalEditor"), element.selectionStart, element.selectionEnd,
		])).toEqual([true, 2, 6])
		for (const name of ["Dependencies", "Environment", "Runs Overview"]) {
			await view.click()
			await page.getByRole("option", { name, exact: true }).click()
			await expect(view).toBeFocused()
			await expect(up).toBeDisabled()
			await expect(down).toBeDisabled()
			await expect(reply).toHaveCount(0)
		}
		await page.getByRole("button", { name: "Return to run", exact: true }).click()
		await expect(reply).toBeFocused()
		await expect(reply).toHaveValue(draft)
		await expect(page.getByRole("group", { name: "Panel divider: bottom" })).toBeVisible()
		await down.press("Enter")
		await down.press("Enter")
		await expect(down).toBeDisabled()
		await expect(up).toBeFocused()
		await view.click()
		await page.getByRole("option", { name: "Runs Overview", exact: true }).click()
		await view.click()
		await page.getByRole("option", { name: "Current Run", exact: true }).click()
		await expect(view).toBeFocused()
		await expect(reply).toHaveValue(draft)
		await page.reload()
		await expect(page.getByRole("button", { name: "Start run", exact: true })).toBeVisible()
		await page.getByRole("button", { name: "Start run", exact: true }).click()
		await expect(reply).toHaveValue("")
		await expect(page.getByRole("group", { name: "Panel divider: top" })).toBeVisible()
		expect(requests).toEqual([])
	})

	test(`mock panels scroll independently and wrap long drafts in ${theme}`, async ({ desktop: { app, page } }) => {
		await app.evaluate(({ BrowserWindow }) => {
			const window = BrowserWindow.getAllWindows()[0]
			window.setContentSize(640, 420)
			window.webContents.setZoomFactor(1.25)
		})
		await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([512, 336])
		if (theme === "light") await page.getByRole("button", { name: "Toggle color theme" }).click()
		await page.getByRole("button", { name: "Start run", exact: true }).click()
		const reply = page.getByRole("textbox", { name: "Reply", exact: true })
		// Sample actual native pixels over an injected contrasting underlay. An
		// opaque panel must paint identically regardless of what is behind it.
		const samples = await page.locator(".hud-panel").evaluateAll(panels => panels.map(panel => {
			const rect = panel.getBoundingClientRect()
			return { x: Math.round((rect.x + rect.width / 2) * 1.25), y: Math.round((rect.bottom - 3) * 1.25) }
		}))
		const samplePixels = () => app.evaluate(async ({ BrowserWindow }, points) => {
			const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage()
			return points.map(point => image.crop({ ...point, width: 5, height: 1 }).toBitmap().toString("hex"))
		}, samples)
		const before = await samplePixels()
		await page.locator(".hud-panel").evaluateAll(panels => panels.forEach(panel => {
			(panel as HTMLElement).style.background = "#ff00ff"
		}))
		await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
		expect(await samplePixels()).toEqual(before)
		await page.locator(".hud-panel").evaluateAll(panels => panels.forEach(panel => panel.removeAttribute("style")))
		await reply.fill(("A long draft " + "x".repeat(180) + "\n").repeat(30))
		await expectPanelGeometry(page, "top")
		await reply.press("Control+End")
		expect(await reply.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
		await page.getByRole("button", { name: "Move panel divider up" }).click()
		await page.getByRole("button", { name: "Move panel divider up" }).click()
		const message = page.getByRole("region", { name: "Agent message text", exact: true })
		await message.focus()
		await message.press("Control+End")
		await expect.poll(() => message.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
		await expectPanelGeometry(page, "bottom")
		await expect(page.getByRole("button", { name: "Move panel divider down" })).toBeEnabled()
		expect(await page.evaluate(() => [scrollX, scrollY])).toEqual([0, 0])
	})
}

test("displays the version from main when launched outside the checkout", async ({ desktop: { app, page } }) => {
	const version = await app.evaluate(({ app }) => app.getVersion())
	await expect(page.locator(".hud-frame__identity").getByRole("status")).toHaveText(`Version ${version}`)
	expect(page.url()).toBe(documentUrl)
	expect(await page.evaluate(() => ({
		require: typeof Reflect.get(window, "require"),
		process: typeof Reflect.get(window, "process"),
		ipcRenderer: typeof Reflect.get(window, "ipcRenderer"),
		bridge: Object.keys(window.robozium),
	}))).toEqual({ require: "undefined", process: "undefined", ipcRenderer: "undefined", bridge: ["getBackendStatus", "retryBackend", "getVersion", "writeClipboardText"] })
	// Playwright disables Chromium sandboxing unless explicitly told otherwise.
	expect(await app.evaluate(({ app }) => app.commandLine.hasSwitch("no-sandbox"))).toBe(false)
})

test("loads the built React script, stylesheet, and font through the local protocol", async ({ desktop: { page } }) => {
	const fontResponse = page.waitForResponse(response =>
		/^robozium:\/\/app\/assets\/source-code-pro-latin-400-normal-.+\.woff2$/.test(response.url()))
	await page.reload()
	expect((await fontResponse).ok()).toBe(true)
	await expect(page.locator(".hud-frame__identity").getByRole("status")).toHaveText(/^Version /)
	await expect(page.locator("script[src]")).toHaveAttribute("src", /^\/assets\/.+\.js$/)
	await expect(page.locator('link[rel="stylesheet"]')).toHaveAttribute("href", /^\/assets\/.+\.css$/)
	expect(await page.evaluate(async () => {
		await document.fonts.ready
		return [...document.fonts].filter(font => font.family === "Source Code Pro").map(font => ({ weight: font.weight, status: font.status }))
	})).toEqual([{ weight: "400", status: "loaded" }])
	await expect(page.getByRole("heading", { level: 1 })).toHaveCSS("font-family", '"Source Code Pro", ui-monospace, monospace')
})

test("switches themes with the keyboard and mouse while retaining focus", async ({ desktop: { page } }) => {
	const root = page.locator("html")
	const toggle = page.getByRole("button", { name: "Toggle color theme" })
	await expect(page.locator("header button")).toHaveText([
		"Mock model", "Light", "Secrets unavailable", "Runs Overview",
	])
	const secrets = page.getByRole("button", { name: "Secrets unavailable", exact: true })
	await expect(secrets).toBeDisabled()
	await expect(secrets).toHaveAttribute("disabled", "")
	await expect(secrets).not.toHaveAttribute("aria-haspopup")
	await expect(secrets).not.toHaveAttribute("aria-expanded")
	await expect(root).toHaveAttribute("data-theme", "dark")
	await expect(toggle).toHaveText("Light")
	await page.keyboard.press("Tab")
	await expect(page.getByRole("combobox", { name: "Base model: Mock model" })).toBeFocused()
	await page.keyboard.press("Tab")
	await expect(toggle).toBeFocused()
	await expect(toggle).toHaveCSS("outline-style", "solid")
	await expect(toggle).toHaveCSS("outline-width", "2px")
	await page.keyboard.press("Space")
	await expect(root).toHaveAttribute("data-theme", "light")
	await expect(root).toHaveCSS("color-scheme", "light")
	await expect(toggle).toHaveText("Dark")
	await expect(toggle).toBeFocused()
	await expect(toggle).toHaveCSS("outline-width", "2px")
	await page.keyboard.press("Tab")
	await expect(page.getByRole("combobox", { name: "HUD view: Runs Overview" })).toBeFocused()
	await page.keyboard.press("Shift+Tab")
	await expect(toggle).toBeFocused()
	await page.keyboard.press("Enter")
	await expect(root).toHaveAttribute("data-theme", "dark")
	await expect(toggle).toBeFocused()
	await toggle.click()
	await expect(root).toHaveAttribute("data-theme", "light")
	await expect(toggle).toBeFocused()
})

for (const theme of ["dark", "light"]) {
	test(`selectors update local selections and view placeholders in ${theme}`, async ({ desktop: { page } }) => {
		const requests: string[] = []
		page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()) })
		const toggle = page.getByRole("button", { name: "Toggle color theme" })
		if (theme === "light") await toggle.click()
		const model = page.getByRole("combobox", { name: /^Base model:/ })
		const view = page.getByRole("combobox", { name: /^HUD view:/ })
		await expect(page.getByRole("region", { name: "Runs Overview" })).toContainText("Start run")
		await model.click()
		await page.getByRole("option", { name: "Mock fast model", exact: true }).click()
		await expect(model).toHaveAccessibleName("Base model: Mock fast model")
		await expect(model).toHaveAttribute("aria-expanded", "false")
		await expect(model).toBeFocused()
		for (const name of ["Dependencies", "Environment", "Environment", "Runs Overview"]) {
			await view.click()
			await page.getByRole("option", { name, exact: true }).click()
			await expect(view).toHaveAccessibleName(`HUD view: ${name}`)
			await expect(view).toBeFocused()
			await expect(page.getByRole("listbox")).toHaveCount(0)
			await expect(page.getByRole("region", { name, exact: true })).toContainText(name === "Runs Overview" ? "Start run" : "This view is coming soon.")
			await expect(page.locator(".hud-frame__identity").getByRole("status")).toHaveText(/^Version /)
		}
		await toggle.click()
		await expect(model).toHaveText("Mock fast model")
		await expect(view).toHaveText("Runs Overview")
		await page.reload()
		await expect(model).toHaveText("Mock model")
		await expect(view).toHaveText("Runs Overview")
		await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
		expect(requests).toEqual([])
	})

	test(`selector keyboard navigation commits and cancels in ${theme}`, async ({ desktop: { page } }) => {
		const toggle = page.getByRole("button", { name: "Toggle color theme" })
		if (theme === "light") await toggle.click()
		const model = page.getByRole("combobox", { name: /^Base model:/ })
		const view = page.getByRole("combobox", { name: /^HUD view:/ })
		const active = page.getByRole("option", { selected: true })
		await model.focus()
		await model.press("Enter")
		await expect(active).toHaveText("Mock model●")
		await expect(model).toHaveAttribute("aria-controls", await page.getByRole("listbox").getAttribute("id") as string)
		await model.press("ArrowDown")
		await expect(active).toHaveText("Mock fast model")
		await expect(model).toHaveAttribute("aria-activedescendant", await active.getAttribute("id") as string)
		await expect(model).toHaveText("Mock model")
		await model.press("Escape")
		await expect(model).toBeFocused()
		await expect(model).not.toHaveAttribute("aria-activedescendant")
		await expect(model).toHaveText("Mock model")
		await model.press("Space")
		await model.press("End")
		await model.press("ArrowDown")
		await expect(active).toHaveText("Mock extended context model")
		await model.press("Home")
		await model.press("ArrowUp")
		await expect(active).toHaveText("Mock model●")
		await model.press("End")
		await model.press("Space")
		await expect(model).toHaveText("Mock extended context model")
		await expect(model).toBeFocused()
		await model.press("ArrowDown")
		await expect(active).toHaveText("Mock extended context model●")
		await model.press("Home")
		await model.press("Tab")
		await expect(model).toHaveText("Mock model")
		await expect(toggle).toBeFocused()
		await toggle.press("Tab")
		await expect(view).toBeFocused()
		await view.press("End")
		await view.press("Shift+Tab")
		await expect(toggle).toBeFocused()
		await expect(page.getByRole("region", { name: "Environment" })).toBeVisible()
		await model.focus()
		await page.keyboard.type("mock f")
		await expect(active).toHaveText("Mock fast model")
		await model.press("Enter")
		await expect(model).toHaveText("Mock fast model")
		await model.press("m")
		await expect(active).toHaveText("Mock extended context model")
		await model.press("m")
		await expect(active).toHaveText("Mock model")
		await model.press("Escape")
		await expect(model).toHaveText("Mock fast model")
	})

	test(`selectors dismiss without stealing outside focus in ${theme}`, async ({ desktop: { page } }) => {
		const toggle = page.getByRole("button", { name: "Toggle color theme" })
		if (theme === "light") await toggle.click()
		const model = page.getByRole("combobox", { name: /^Base model:/ })
		const view = page.getByRole("combobox", { name: /^HUD view:/ })
		await model.click()
		await model.press("End")
		await toggle.click()
		await expect(model).toHaveText("Mock extended context model")
		await expect(toggle).toBeFocused()
		await expect(page.getByRole("listbox")).toHaveCount(0)
		await model.click()
		await view.click()
		await expect(model).toHaveAttribute("aria-expanded", "false")
		await expect(view).toHaveAttribute("aria-expanded", "true")
		await expect(page.getByRole("listbox")).toHaveCount(1)
		await expect(page.getByRole("listbox", { name: "HUD view" })).toBeVisible()
		await view.press("ArrowDown")
		await view.click()
		await expect(view).toHaveText("Runs Overview")
		await expect(view).toBeFocused()
		await view.press("e")
		await page.getByRole("heading", { name: "Robozium", exact: true }).click()
		await expect(view).toHaveText("Environment")
		await expect(page.getByRole("listbox")).toHaveCount(0)
	})
}

test("native Ctrl shortcuts zoom both ways and reset with an open selector", async ({ desktop: { app, page } }) => {
	const model = page.getByRole("combobox", { name: "Base model: Mock model" })
	await model.click()
	for (const [keyCode, level] of [
		["-", -0.5], ["=", 0], ["+", 0.5], ["numadd", 1],
		["numsub", 0.5], ["-", 0], ["=", 0.5], ["0", 0],
	] as const) {
		// CDP page.keyboard bypasses Electron's native shortcut handling.
		await app.evaluate(({ BrowserWindow }, keyCode) => {
			const window = BrowserWindow.getAllWindows()[0]
			window.focus()
			const modifier = process.platform === "darwin" ? "meta" : "control"
			window.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers: [modifier] })
			window.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers: [modifier] })
		}, keyCode)
		await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
			BrowserWindow.getAllWindows()[0].webContents.getZoomLevel()), { message: `Zoom after Ctrl+${keyCode}` })
			.toBeCloseTo(level)
		await expect(model).toBeFocused()
		await expect(model).toHaveAttribute("aria-expanded", "true")
		await expect(page.getByRole("option", { selected: true })).toHaveText("Mock model●")
	}
})

for (const [width, height] of [[1260, 780], [640, 420]]) {
	for (const zoom of [1, 1.25]) {
		test(`frame fits ${width}x${height} at ${zoom} zoom in both themes`, async ({ desktop: { app, page } }) => {
			await page.getByRole("button", { name: "Start run", exact: true }).click()
			await page.getByRole("textbox", { name: "Reply", exact: true }).blur()
			await app.evaluate(({ BrowserWindow }, { width, height, zoom }) => {
				const window = BrowserWindow.getAllWindows()[0]
				window.setContentSize(width, height)
				window.webContents.setZoomFactor(zoom)
			}, { width, height, zoom })
			await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight]))
				.toEqual([width / zoom, height / zoom])
			await expect(page.locator(".hud-frame__identity").getByRole("status")).toHaveText(/^Version /)
			await page.evaluate(async () => { await document.fonts.ready })
			for (const theme of ["dark", "light"]) {
				if (theme === "light") await page.getByRole("button", { name: "Toggle color theme" }).click()
				await expect(page.locator("html")).toHaveAttribute("data-theme", theme)
				for (const [role, name, title] of [
					["combobox", "Base model: Mock model", "Mock model"],
					["button", "Secrets unavailable", "Secrets unavailable"],
					["combobox", "HUD view: Current Run", "Current Run"],
				] as const) {
					const control = page.getByRole(role, { name, exact: true })
					await expect(control).toHaveAccessibleName(name)
					await expect(control).toHaveAttribute("title", title)
				}
				await expect(page.getByRole("button", { name: "Toggle color theme" }))
					.toHaveAttribute("title", `Switch to ${theme === "dark" ? "light" : "dark"} theme`)
				await page.mouse.move(0, 0)
				const geometry = await page.evaluate(() => {
					const frame = document.querySelector("main")!.getBoundingClientRect()
					const header = document.querySelector("header")!.getBoundingClientRect()
					const buttons = [...document.querySelectorAll("header button")]
						.map(element => element.getBoundingClientRect())
					const labels = [...document.querySelectorAll(".hud-header__label")]
					const contents = [...document.querySelectorAll("h1, h2, p, button")]
					return {
						frame: [frame.x, frame.y, frame.width, frame.height],
						contained: contents.every(element => {
							const rect = element.getBoundingClientRect()
							return rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth
								&& rect.bottom <= innerHeight && element.scrollWidth <= element.clientWidth
						}),
						// Native zoom introduces subpixel rounding in DOMRect sums.
						headerContained: buttons.every((rect, index) =>
							rect.x >= header.x - 0.01 && rect.right <= header.right + 0.01
							&& rect.y >= header.y - 0.01 && rect.bottom <= header.bottom + 0.01 && rect.width > 0
							&& (index === 0 || rect.x > buttons[index - 1].right)
							&& Math.abs(rect.y + rect.height / 2 - header.y - header.height / 2) < 1),
						modelCapped: buttons[0].width <= header.width * 0.4,
						labelsReadable: labels.every(element => {
							const style = getComputedStyle(element)
							return element.clientWidth > 0 && (element.scrollWidth <= element.clientWidth
								|| (style.overflow === "hidden" && style.textOverflow === "ellipsis"
									&& style.whiteSpace === "nowrap"))
						}),
						scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
					}
				})
				expect(geometry).toEqual({
					frame: [0, 0, width / zoom, height / zoom],
					contained: true,
					headerContained: true,
					modelCapped: true,
					labelsReadable: true,
					scroll: [width / zoom, height / zoom],
				})
				await page.getByRole("button", { name: "Toggle color theme" }).click({ trial: true })
				expect(await captureNative(app, page, width, height)).toMatchSnapshot(`frame-${theme}-${width}x${height}-${zoom}.png`, {
					threshold: 0.2, maxDiffPixelRatio: 0.002,
				})
				for (const [kind, name] of [["model", /^Base model:/], ["view", /^HUD view:/]] as const) {
					const selector = page.getByRole("combobox", { name })
					await selector.click()
					await selector.press("End")
					await expect(selector).toBeFocused()
					expect(await page.getByRole("listbox").evaluate(menu => {
						const bounds = menu.getBoundingClientRect()
						return {
							contained: bounds.x >= 0 && bounds.y >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight,
							optionsVisible: [...menu.children].every(option => {
								const rect = option.getBoundingClientRect()
								return rect.top >= bounds.top && rect.bottom <= bounds.bottom && option.scrollWidth <= option.clientWidth
							}),
							scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
						}
					})).toEqual({ contained: true, optionsVisible: true, scroll: [width / zoom, height / zoom] })
					await expect(page.getByRole("option", { selected: true })).toHaveCSS("outline-style", "solid")
					if (width === 640 && zoom === 1.25) {
						expect(await captureNative(app, page, width, height)).toMatchSnapshot(`selector-${kind}-${theme}.png`, {
							threshold: 0.2, maxDiffPixelRatio: 0.002,
						})
					}
					await selector.press("Escape")
				}
				for (const layout of ["top", "equal", "bottom"] as const) {
					if (layout !== "top") await page.getByRole("button", { name: "Move panel divider up" }).click()
					await expect(page.getByRole("region", { name: "Current Run", exact: true })).toHaveAttribute("data-layout", layout)
					await expectPanelGeometry(page, layout)
					await expectFooterGeometry(page)
					if (layout !== "top" && width === 640 && zoom === 1.25) {
						await page.getByRole("button", { name: "Move panel divider down" }).blur()
						expect(await captureNative(app, page, width, height)).toMatchSnapshot(`panels-${layout}-${theme}.png`, {
							threshold: 0.2, maxDiffPixelRatio: 0.002,
						})
					}
				}
				await page.getByRole("button", { name: "Move panel divider down" }).click()
				await page.getByRole("button", { name: "Move panel divider down" }).click()
				const model = page.getByRole("combobox", { name: /^Base model:/ })
				await model.press("End")
				await model.press("Enter")
				await expect(model).toHaveAccessibleName("Base model: Mock extended context model")
				await expect(model).toHaveAttribute("title", "Mock extended context model")
				expect(await model.evaluate(button => {
					const header = button.closest("header")!.getBoundingClientRect()
					const label = button.querySelector("span")!
					return button.getBoundingClientRect().width <= header.width * 0.4
						&& document.documentElement.scrollWidth === innerWidth && label.clientWidth > 0
				})).toBe(true)
				await model.press("Home")
				await model.press("Enter")
				const view = page.getByRole("combobox", { name: /^HUD view:/ })
				for (const name of ["Runs Overview", "Dependencies", "Environment"]) {
					await view.click()
					await page.getByRole("option", { name, exact: true }).click()
					await expect(page.getByRole("region", { name, exact: true })).toBeVisible()
					expect(await page.locator(".hud-frame__content").evaluate(content => {
						const bounds = content.firstElementChild!.getBoundingClientRect()
						return bounds.x >= 0 && bounds.y >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight
							&& document.documentElement.scrollWidth === innerWidth && document.documentElement.scrollHeight === innerHeight
					})).toBe(true)
				}
				await view.click()
				await page.getByRole("option", { name: "Current Run", exact: true }).click()
			}
		})
	}
}

for (const [name, url, method, status] of [
	["unknown host", "robozium://other/index.html", "GET", 404],
	["missing file", "robozium://app/missing.html", "GET", 404],
	["directory", "robozium://app/assets/", "GET", 404],
	["malformed encoding", "robozium://app/%E0%A4%A", "GET", 400],
	["null byte", "robozium://app/index.html%00", "GET", 400],
	["POST", documentUrl, "POST", 405],
	["HEAD", documentUrl, "HEAD", 405],
] as const) {
	test(`rejects a resource request with ${name}`, async ({ desktop: { app } }) => {
		const result = await app.evaluate(async ({ net }, { url, method }) => {
			const response = await net.fetch(url, { method })
			return { status: response.status, allow: response.headers.get("allow") }
		}, { url, method })
		expect(result.status).toBe(status)
		if (status === 405) expect(result.allow).toBe("GET")
	})
}

test("cannot read outside the renderer directory through traversal or symlinks", async ({ desktop: { app } }) => {
	const outside = await mkdtemp(path.join(desktopRoot, "dist/outside-"))
	const link = path.join(desktopRoot, "dist/renderer", path.basename(outside))
	const marker = "This fixture must never be served by the renderer protocol."
	try {
		await writeFile(path.join(outside, "fixture.html"), marker)
		await symlink(outside, link, "dir")
		for (const [pathname, status] of [
			[`/../${path.basename(outside)}/fixture.html`, 404],
			[`/..%2f${path.basename(outside)}/fixture.html`, 400],
			[`/%2e%2e%5c${path.basename(outside)}/fixture.html`, 400],
			[`/${path.basename(outside)}/fixture.html`, 404],
		] as const) {
			const result = await app.evaluate(async ({ net }, url) => {
				const response = await net.fetch(url)
				return { status: response.status, body: await response.text() }
			}, `robozium://app${pathname}`)
			expect(result.status, pathname).toBe(status)
			expect(result.body).not.toContain(marker)
		}
	} finally {
		await rm(link, { force: true })
		await rm(outside, { recursive: true, force: true })
	}
})

test("rejects the version request from a different window", async ({ desktop: { app } }) => {
	const result = await app.evaluate(async ({ BrowserWindow }, { preload, documentUrl }) => {
		const other = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false } })
		try {
			await other.loadURL(documentUrl)
			return await other.webContents.executeJavaScript(`(async () => {
				try {
					await window.robozium.getVersion()
					return "allowed"
				} catch {
					return "denied"
				}
			})()`)
		} finally { other.destroy() }
	}, { preload, documentUrl })
	expect(result).toBe("denied")
})

test("rejects the version request from a different document in the main window", async ({ desktop: { app, page } }) => {
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].loadURL("about:blank"))
	expect(await page.evaluate(async () => {
		try {
			await window.robozium.getVersion()
			return "allowed"
		} catch {
			return "denied"
		}
	})).toBe("denied")
})

test("shows a readable error when the version request fails", async ({ desktop: { app, page } }) => {
	await app.evaluate(({ ipcMain }) => ipcMain.removeHandler("desktop:version"))
	await page.reload()
	await expect(page.getByRole("alert")).toHaveText("Unable to read the application version.")
})

test("blocks renderer navigation and popups", async ({ desktop: { app, page } }) => {
	const blocked = await app.evaluate(async ({ BrowserWindow }) => {
		const contents = BrowserWindow.getAllWindows()[0].webContents
		const navigation = new Promise<boolean>(resolve => {
			contents.once("will-frame-navigate", event => resolve(event.defaultPrevented))
		})
		await contents.executeJavaScript("location.href = 'https://example.invalid/'")
		return navigation
	})
	expect(blocked).toBe(true)
	expect(await page.evaluate(() => window.open("https://example.invalid/") === null)).toBe(true)
	expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
	expect(page.url()).toBe(documentUrl)
})

test("native close exits and the same profile can reopen", async ({ desktop: { app } }) => {
	const profile = await app.evaluate(({ app }) => app.getPath("userData"))
	const exited = once(app.process(), "exit")
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
	expect(await exited).toEqual([0, null])
	const reopened = await _electron.launch({
		args: launchArgs,
		chromiumSandbox: true,
		cwd: path.dirname(profile),
		env: { ...process.env, ROBOZIUM_DESKTOP_TEST_DATA: profile },
		timeout: 15_000,
	})
	try {
		await expect((await reopened.firstWindow()).getByRole("status")).toHaveText(/^Version /)
	} finally { await reopened.close() }
})
