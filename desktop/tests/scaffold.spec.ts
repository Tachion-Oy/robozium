import { _electron, expect, type Page } from "@playwright/test"
import { once } from "node:events"
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { test, desktopRoot, launchArgs, documentUrl, preload, waitForPanelLayout, captureNative, chooseModel, chooseView, modelTrigger, setNativeViewport, viewTrigger } from "./native"
import { expectFooterGeometry } from "./footer-geometry"

async function expectPanelGeometry(page: Page, layout: "top" | "equal" | "bottom") {
	await waitForPanelLayout(page)
	const geometry = await page.locator(".agent-hud__panels").evaluate(container => {
		const panels = [...container.querySelectorAll<HTMLElement>(".agent-hud__replyBox")]
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

/** Wait for selector transitions to settle away from the pointer before measuring the header row. */
async function expectSettledHeaderRow(page: Page) {
	await page.mouse.move(0, 0)
	await expect.poll(() => headerRow(page)).toEqual({ ordered: true, centred: true, contained: true, readable: true })
}

/** The reference header keeps its controls in one row inside the window and ellipsizes long labels. */
async function headerRow(page: Page) {
	return page.locator(".agent-hud__header").evaluate(header => {
		const controls = [...header.querySelectorAll("button.agent-hud__selector-trigger")]
			.map(control => control.getBoundingClientRect())
		const labels = [...header.querySelectorAll<HTMLElement>(".agent-hud__model-trigger > span, .theme-toggle__label")]
			.filter(label => label.getClientRects().length > 0)
		const middle = (rect: DOMRect) => rect.y + rect.height / 2
		return {
			ordered: controls.length === 3 && controls.every((rect, index) => index === 0 || rect.x >= controls[index - 1].right),
			centred: controls.every(rect => Math.abs(middle(rect) - middle(controls[0])) < 1),
			contained: controls.every(rect => rect.x >= 0 && rect.right <= innerWidth && rect.y >= 0)
				&& document.documentElement.scrollWidth === innerWidth,
			readable: labels.every(label => {
				const style = getComputedStyle(label)
				return label.clientWidth > 0 && (label.scrollWidth <= label.clientWidth
					|| (style.overflow === "hidden" && style.textOverflow === "ellipsis" && style.whiteSpace === "nowrap"))
			}),
		}
	})
}

for (const theme of ["dark", "light"]) {
	test(`header keeps model, theme and view in one row and truncates labels in ${theme}`, async ({ desktop: { app, page } }) => {
		if (theme === "light") await page.getByRole("button", { name: "Toggle color theme" }).click()
		await page.getByRole("button", { name: "Launch", exact: true }).click()
		await page.evaluate(async () => { await document.fonts.ready })
		for (const [width, height, zoom] of [[1260, 780, 1], [640, 420, 1.25]]) {
			await setNativeViewport(app, page, width, height, zoom)
			for (const name of ["Mock model", "Mock fast model", "Mock extended context model"]) {
				await chooseModel(page, name)
				await expect(modelTrigger(page)).toHaveAttribute("title", name)
				await expect(modelTrigger(page)).toHaveAccessibleName(name)
				await expectSettledHeaderRow(page)
			}
		}
	})

	test(`divider buttons stay square with centered arrows in ${theme}`, async ({ desktop: { app, page } }) => {
		for (const zoom of [1, 1.25]) {
			await app.evaluate(({ BrowserWindow }, zoom) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(zoom), zoom)
			await page.reload()
			if (theme === "light") await page.getByRole("button", { name: "Toggle color theme" }).click()
			for (const state of ["idle", "top", "equal", "bottom"]) {
				if (state === "top") await page.getByRole("button", { name: "Launch", exact: true }).click()
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
		await page.getByRole("button", { name: "Launch", exact: true }).click()
		const motion = await page.evaluate(async () => {
			const panels = document.querySelector(".agent-hud__panels")!
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
		expect(await page.locator(".agent-hud__panels").evaluate(panels => panels.getAnimations({ subtree: true }).length)).toBe(0)
		await expectPanelGeometry(page, "top")
	})

	test(`mock run preserves editing and divider state in ${theme}`, async ({ desktop: { app, page } }) => {
		const requests: string[] = []
		page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()) })
		const toggle = page.getByRole("button", { name: "Toggle color theme" })
		const view = viewTrigger(page)
		const up = page.getByRole("button", { name: "Move panel divider up" })
		const down = page.getByRole("button", { name: "Move panel divider down" })
		const reply = page.getByRole("textbox", { name: "Type your reply...", exact: true })
		if (theme === "light") await toggle.click()
		await expect(up).toBeDisabled()
		await expect(down).toBeDisabled()
		await view.click()
		await expect(page.getByRole("option", { name: "Current Run", exact: true })).toHaveCount(0)
		await page.keyboard.press("Escape")
		await page.getByRole("button", { name: "Launch", exact: true }).press("Enter")
		await expect(reply).toBeFocused()
		await expect(view).toHaveAccessibleName("Current Run")
		await expect(page.locator(".agent-hud__replyBox--agent")).toContainText("Mock run ready.")
		await reply.fill("First line")
		// Enter submits (unavailable until replies arrive); Shift+Enter adds a line.
		await reply.press("Enter")
		await reply.press("Shift+Enter")
		await reply.pressSequentially("Last line")
		const draft = "First line\nLast line"
		await expect(reply).toHaveValue(draft)
		await chooseModel(page, "Mock fast model")
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
		await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())).toBeCloseTo(1.1)
		await expect(reply).toBeFocused()
		await toggle.click()
		await toggle.click()
		await up.click()
		await expect(up).toBeFocused()
		await expectPanelGeometry(page, "equal")
		await up.press("Space")
		await expect(up).toBeDisabled()
		await expectPanelGeometry(page, "bottom")
		expect(await reply.evaluate((element: HTMLTextAreaElement) => [
			element === Reflect.get(window, "originalEditor"), element.selectionStart, element.selectionEnd,
		])).toEqual([true, 2, 6])
		for (const name of ["Dependencies", "Environment", "Runs Overview"]) {
			await chooseView(page, name)
			await expect(up).toBeDisabled()
			await expect(down).toBeDisabled()
			await expect(reply).toHaveCount(0)
		}
		await page.getByRole("button", { name: "Return to preview", exact: true }).click()
		await expect(reply).toBeFocused()
		await expect(reply).toHaveValue(draft)
		await expect(page.getByRole("group", { name: "Panel divider: bottom" })).toBeVisible()
		await down.press("Enter")
		await down.press("Enter")
		await expect(down).toBeDisabled()
		await chooseView(page, "Runs Overview")
		await chooseView(page, "Current Run")
		await expect(reply).toHaveValue(draft)
		await page.reload()
		await expect(page.getByRole("button", { name: "Launch", exact: true })).toBeVisible()
		await page.getByRole("button", { name: "Launch", exact: true }).click()
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
		await page.getByRole("button", { name: "Launch", exact: true }).click()
		const reply = page.getByRole("textbox", { name: "Type your reply...", exact: true })
		await reply.fill(("A long draft " + "x".repeat(180) + "\n").repeat(30))
		await expectPanelGeometry(page, "top")
		await reply.press("Control+End")
		expect(await reply.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
		await page.getByRole("button", { name: "Move panel divider up" }).click()
		await page.getByRole("button", { name: "Move panel divider up" }).click()
		const message = page.locator(".agent-hud__replyBox-scroll")
		await message.hover()
		await page.mouse.wheel(0, 600)
		await expect.poll(() => message.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
		await expectPanelGeometry(page, "bottom")
		await expect(page.getByRole("button", { name: "Move panel divider down" })).toBeEnabled()
		expect(await page.evaluate(() => [scrollX, scrollY])).toEqual([0, 0])
	})
}

test("exposes the version bridge when launched outside the checkout", async ({ desktop: { app, page } }) => {
	const version = await app.evaluate(({ app }) => app.getVersion())
	expect(await page.evaluate(() => window.robozium.getVersion())).toBe(version)
	expect(page.url()).toBe(documentUrl)
	expect(await page.evaluate(() => ({
		require: typeof Reflect.get(window, "require"),
		process: typeof Reflect.get(window, "process"),
		ipcRenderer: typeof Reflect.get(window, "ipcRenderer"),
		bridge: Object.keys(window.robozium),
	}))).toEqual({ require: "undefined", process: "undefined", ipcRenderer: "undefined", bridge: ["theme", "setTheme", "getBackendConnection", "getBackendStatus", "retryBackend", "restartBackend", "recreateBackend", "restartApp", "getVersion", "writeClipboardText", "getMessageLog", "setMessageLog"] })
	// Playwright disables Chromium sandboxing unless explicitly told otherwise.
	expect(await app.evaluate(({ app }) => app.commandLine.hasSwitch("no-sandbox"))).toBe(false)
})

test("loads the built React script, stylesheet, and fonts through the local protocol", async ({ desktop: { page } }) => {
	const fontResponse = page.waitForResponse(response =>
		/^robozium:\/\/app\/assets\/source-code-pro-latin-400-normal-.+\.woff2$/.test(response.url()))
	await page.reload()
	expect((await fontResponse).ok()).toBe(true)
	await expect(page.locator("script[src]")).toHaveAttribute("src", /^\/assets\/.+\.js$/)
	await expect(page.locator('link[rel="stylesheet"]')).toHaveAttribute("href", /^\/assets\/.+\.css$/)
	await page.evaluate(async () => { await document.fonts.ready })
	expect(await page.evaluate(() => [...document.fonts]
		.filter(font => font.status === "loaded").map(font => `${font.family} ${font.weight}`).sort()))
		.toEqual(expect.arrayContaining(["Source Code Pro 400", "VT323 400"]))
	await expect(modelTrigger(page)).toHaveCSS("font-family", /^"Source Code Pro"/)
})

test("switches themes with the keyboard and mouse while retaining focus", async ({ desktop: { page } }) => {
	const root = page.locator("html")
	const toggle = page.getByRole("button", { name: "Toggle color theme" })
	const shownLabel = () => toggle.locator(".theme-toggle__label").filter({ visible: true })
	expect(await page.locator(".agent-hud__header button").evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-label"))))
		.toEqual(["Mock model", "Toggle color theme", "Runs Overview"])
	await expect(root).toHaveAttribute("data-theme", "dark")
	await expect(shownLabel()).toHaveText("Light")
	// As in the reference, the message log toggle precedes the header.
	await page.keyboard.press("Tab")
	await expect(page.getByRole("button", { name: "Show message log", exact: true })).toBeFocused()
	await page.keyboard.press("Tab")
	await expect(modelTrigger(page)).toBeFocused()
	await page.keyboard.press("Tab")
	await expect(toggle).toBeFocused()
	await page.keyboard.press("Space")
	await expect(root).toHaveAttribute("data-theme", "light")
	await expect(root).toHaveCSS("color-scheme", "light")
	await expect(shownLabel()).toHaveText("Dark")
	await expect(toggle).toBeFocused()
	await page.keyboard.press("Tab")
	await expect(viewTrigger(page)).toBeFocused()
	await page.keyboard.press("Shift+Tab")
	await expect(toggle).toBeFocused()
	await page.keyboard.press("Enter")
	await expect(root).toHaveAttribute("data-theme", "dark")
	await expect(root).toHaveCSS("color-scheme", "dark")
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
		await expect(page.locator(".agent-hud__project-view")).toContainText("New Project")
		await chooseModel(page, "Mock fast model")
		await expect(modelTrigger(page)).toHaveAccessibleName("Mock fast model")
		await expect(modelTrigger(page)).toHaveAttribute("aria-expanded", "false")
		for (const name of ["Dependencies", "Environment", "Environment", "Runs Overview"]) {
			await chooseView(page, name)
			await expect(viewTrigger(page)).toHaveAccessibleName(name)
			await expect(page.getByRole("listbox")).toHaveCount(0)
			if (name === "Runs Overview") await expect(page.locator(".agent-hud__project-view")).toContainText("New Project")
			else await expect(page.getByRole("region", { name, exact: true })).toContainText("This view is coming soon.")
		}
		await page.reload()
		await expect(modelTrigger(page)).toHaveAccessibleName("Mock model")
		await expect(viewTrigger(page)).toHaveAccessibleName("Runs Overview")
		await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
		expect(requests).toEqual([])
	})

	test(`selector keyboard navigation commits and cancels in ${theme}`, async ({ desktop: { page } }) => {
		if (theme === "light") await page.getByRole("button", { name: "Toggle color theme" }).click()
		const model = modelTrigger(page)
		const menu = page.getByRole("listbox", { name: "Base model" })
		await model.focus()
		await model.press("Enter")
		await expect(model).toHaveAttribute("aria-controls", await menu.getAttribute("id") as string)
		// The open menu focuses the selected option; arrows move through enabled options.
		await expect(menu.getByRole("option", { name: "Mock model", exact: true })).toBeFocused()
		await page.keyboard.press("ArrowDown")
		await expect(menu.getByRole("option", { name: "Mock fast model", exact: true })).toBeFocused()
		await page.keyboard.press("ArrowUp")
		await page.keyboard.press("ArrowUp")
		await expect(menu.getByRole("option", { name: "Mock extended context model", exact: true })).toBeFocused()
		await page.keyboard.press("Escape")
		await expect(menu).toHaveCount(0)
		await expect(model).toBeFocused()
		await expect(model).toHaveAccessibleName("Mock model")
		await model.press("Space")
		await page.keyboard.press("ArrowDown")
		await page.keyboard.press("Enter")
		await expect(menu).toHaveCount(0)
		await expect(model).toHaveAccessibleName("Mock fast model")
		await expect(page.getByRole("option", { selected: true })).toHaveCount(0)
		await chooseView(page, "Environment")
		await expect(page.getByRole("region", { name: "Environment" })).toBeVisible()
	})

	test(`selectors dismiss without stealing outside focus in ${theme}`, async ({ desktop: { page } }) => {
		const toggle = page.getByRole("button", { name: "Toggle color theme" })
		if (theme === "light") await toggle.click()
		await modelTrigger(page).click()
		await page.keyboard.press("ArrowDown")
		await toggle.click()
		await expect(modelTrigger(page)).toHaveAccessibleName("Mock model")
		await expect(toggle).toBeFocused()
		await expect(page.getByRole("listbox")).toHaveCount(0)
		await modelTrigger(page).click()
		await viewTrigger(page).click()
		await expect(modelTrigger(page)).toHaveAttribute("aria-expanded", "false")
		await expect(viewTrigger(page)).toHaveAttribute("aria-expanded", "true")
		await expect(page.getByRole("listbox")).toHaveCount(1)
		await expect(page.getByRole("listbox", { name: "HUD view" })).toBeVisible()
		await viewTrigger(page).click()
		await expect(page.getByRole("listbox")).toHaveCount(0)
		await expect(viewTrigger(page)).toHaveAccessibleName("Runs Overview")
	})
}

test("native Ctrl shortcuts zoom both ways and reset with an open selector", async ({ desktop: { app, page } }) => {
	await modelTrigger(page).click()
	const selected = page.getByRole("option", { selected: true })
	for (const [keyCode, factor] of [
		["-", 0.9], ["=", 1], ["+", 1.1], ["numadd", 1.2],
		["numsub", 1.1], ["-", 1], ["=", 1.1], ["0", 1],
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
			BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()), { message: `Zoom after Ctrl+${keyCode}` })
			.toBeCloseTo(factor)
		await expect(selected).toBeFocused()
		await expect(selected).toHaveAccessibleName("Mock model")
		await expect(modelTrigger(page)).toHaveAttribute("aria-expanded", "true")
	}
})

for (const [width, height] of [[1260, 780], [640, 420]]) {
	for (const zoom of [1, 1.25]) {
		test(`frame fits ${width}x${height} at ${zoom} zoom in both themes`, async ({ desktop: { app, page } }) => {
			await page.getByRole("button", { name: "Launch", exact: true }).click()
			await page.getByRole("textbox", { name: "Type your reply...", exact: true }).blur()
			await setNativeViewport(app, page, width, height, zoom)
			await page.evaluate(async () => { await document.fonts.ready })
			for (const theme of ["dark", "light"]) {
				if (theme === "light") await page.getByRole("button", { name: "Toggle color theme" }).click()
				await expect(page.locator("html")).toHaveAttribute("data-theme", theme)
				await expect(modelTrigger(page)).toHaveAttribute("title", "Mock model")
				await expect(viewTrigger(page)).toHaveAttribute("title", "Current Run")
				await expect(page.locator(".agent-hud__event-text")).toBeVisible()
				await page.mouse.move(0, 0)
				expect(await page.locator(".agent-hud__box").evaluate(box => {
					const rect = box.getBoundingClientRect()
					return [rect.x, rect.y, rect.width, rect.height,
						document.documentElement.scrollWidth, document.documentElement.scrollHeight]
				})).toEqual([0, 0, width / zoom, height / zoom, width / zoom, height / zoom])
				await expectSettledHeaderRow(page)
				await page.getByRole("button", { name: "Toggle color theme" }).click({ trial: true })
				expect(await captureNative(app, page, width, height)).toMatchSnapshot(`frame-${theme}-${width}x${height}-${zoom}.png`, {
					threshold: 0.2, maxDiffPixelRatio: 0.002,
				})
				for (const [kind, trigger, name] of [["model", modelTrigger(page), "Base model"], ["view", viewTrigger(page), "HUD view"]] as const) {
					await trigger.click()
					expect(await page.getByRole("listbox", { name }).evaluate(menu => {
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
					if (width === 640 && zoom === 1.25) {
						expect(await captureNative(app, page, width, height)).toMatchSnapshot(`selector-${kind}-${theme}.png`, {
							threshold: 0.2, maxDiffPixelRatio: 0.002,
						})
					}
					await page.keyboard.press("Escape")
				}
				for (const layout of ["top", "equal", "bottom"] as const) {
					if (layout !== "top") await page.getByRole("button", { name: "Move panel divider up" }).click()
					await expect(page.locator(".agent-hud__panels")).toHaveAttribute("data-layout", layout)
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
				await chooseModel(page, "Mock extended context model")
				await expectSettledHeaderRow(page)
				await chooseModel(page, "Mock model")
				for (const name of ["Runs Overview", "Dependencies", "Environment"]) {
					await chooseView(page, name)
					const view = name === "Runs Overview"
						? page.locator(".agent-hud__project-view")
						: page.getByRole("region", { name, exact: true })
					await expect(view).toBeVisible()
					expect(await view.evaluate(element => {
						const bounds = element.getBoundingClientRect()
						return bounds.x >= 0 && bounds.y >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight
							&& document.documentElement.scrollWidth === innerWidth && document.documentElement.scrollHeight === innerHeight
					})).toBe(true)
				}
				await chooseView(page, "Current Run")
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
		await expect((await reopened.firstWindow()).locator(".agent-hud__box")).toBeVisible()
	} finally { await reopened.close() }
})
