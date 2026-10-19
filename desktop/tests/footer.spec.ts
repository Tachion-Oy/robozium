import { expect } from "@playwright/test"
import type { Page } from "@playwright/test"
import { test, captureNative, chooseModel, chooseView, documentUrl, preload, waitForPanelLayout } from "./native"
import { expectFooterGeometry } from "./footer-geometry"

// The reference renames a copy button to "... copied" while it confirms, so
// these locate the buttons by position: user reply first, agent output second.
const copyButtons = (page: Page) => page.locator(".agent-hud__copy-text:not(.agent-hud__clear-reply)")
const copyReplyButton = (page: Page) => copyButtons(page).nth(0)
const copyAgentButton = (page: Page) => copyButtons(page).nth(1)
const agentText = (page: Page) => page.locator(".agent-hud__replyBox--agent pre")

test("fixture history navigates without wrapping and retains selection with draft and divider", async ({ desktop: { page } }) => {
	const footer = page.locator(".agent-hud__actions")
	await expect(footer).toHaveCount(0)
	await page.getByRole("button", { name: "Launch", exact: true }).click()
	const message = page.locator(".agent-hud__replyBox--agent")
	const first = page.getByRole("button", { name: "Jump to first agent message", exact: true })
	const previous = page.getByRole("button", { name: "Previous agent message", exact: true })
	const next = page.getByRole("button", { name: "Next agent message", exact: true })
	const latest = page.getByRole("button", { name: "Jump to latest agent message", exact: true })
	await expect(message).toContainText("Mock run ready.")
	await expect(next).toBeDisabled()
	await expect(latest).toBeDisabled()
	await expect(page.locator(".agent-hud__logo--actions")).toHaveAttribute("data-agent-state", "awaiting-input")
	for (const name of ["Cancel", "Interrupt", "Record", "Send"]) {
		await expect(footer.getByRole("button", { name, exact: true })).toBeDisabled()
	}
	await previous.press("Enter")
	await expect(message).toContainText("Planning the next steps.")
	await previous.press("Space")
	await expect(message).toContainText("Mock run created.")
	await expect(first).toBeDisabled()
	await expect(previous).toBeDisabled()
	await next.press("Enter")
	await expect(message).toContainText("Planning the next steps.")
	await next.press("Enter")
	await expect(message).toContainText("Mock run ready.")
	await first.press("Space")
	await expect(message).toContainText("Mock run created.")
	await latest.press("Space")
	await expect(message).toContainText("Mock run ready.")
	await previous.press("Enter")
	const reply = page.getByRole("textbox", { name: "Type your reply...", exact: true })
	await reply.fill(" retained\n draft ")
	await page.getByRole("button", { name: "Move panel divider up" }).click()
	await chooseModel(page, "Mock extended context model")
	await page.getByRole("button", { name: "Toggle color theme" }).click()
	for (const name of ["Dependencies", "Environment", "Runs Overview"]) {
		await chooseView(page, name)
		await expect(footer).toHaveCount(0)
	}
	await page.getByRole("button", { name: "Return to preview", exact: true }).click()
	await expect(message).toContainText("Planning the next steps.")
	await expect(reply).toHaveValue(" retained\n draft ")
	await expect(page.getByRole("group", { name: "Panel divider: equal" })).toBeVisible()
	await page.reload()
	await page.getByRole("button", { name: "Launch", exact: true }).click()
	await expect(message).toContainText("Mock run ready.")
	await expect(reply).toHaveValue("")
})

test("copy preserves exact text, expires feedback, clears stale feedback, and Clear keeps the same editor", async ({ desktop: { app, page } }) => {
	await page.getByRole("button", { name: "Launch", exact: true }).click()
	const reply = page.getByRole("textbox", { name: "Type your reply...", exact: true })
	const copyReply = copyReplyButton(page)
	const copyAgent = copyAgentButton(page)
	await expect(copyReply).toHaveAccessibleName("Copy user reply")
	await expect(copyAgent).toHaveAccessibleName("Copy agent output")
	const clear = page.getByRole("button", { name: "Clear reply", exact: true })
	await expect(copyReply).toBeDisabled()
	await expect(clear).toBeDisabled()
	await expect(copyAgent).toBeEnabled()
	await reply.evaluate(element => Reflect.set(window, "originalEditor", element))
	const draft = "  first line\n\n\tlast line  \n"
	await reply.fill(draft)
	await copyReply.click()
	await expect(copyReply).toHaveAttribute("data-copied", "true")
	await expect(copyReply).toHaveAccessibleName("User reply copied")
	expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(draft)
	await expect(copyReply).not.toHaveAttribute("data-copied", { timeout: 3000 })
	await copyReply.click()
	await expect(copyReply).toHaveAttribute("data-copied", "true")
	await reply.fill("changed")
	await expect(copyReply).not.toHaveAttribute("data-copied")
	await reply.fill(draft)
	await copyAgent.click()
	await expect(copyAgent).toHaveAttribute("data-copied", "true")
	expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(await agentText(page).textContent())
	await page.getByRole("button", { name: "Previous agent message", exact: true }).click()
	await expect(copyAgent).not.toHaveAttribute("data-copied")
	await copyAgent.click()
	await expect(copyAgent).toHaveAttribute("data-copied", "true")
	expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(await agentText(page).textContent())
	await clear.press("Enter")
	await expect(reply).toHaveValue("")
	expect(await reply.evaluate(element => element === Reflect.get(window, "originalEditor"))).toBe(true)
	await expect(copyReply).toBeDisabled()
	await expect(clear).toBeDisabled()
	await reply.fill(" \n\t ")
	await expect(clear).toBeEnabled()
	await copyReply.click()
	await expect(copyReply).toHaveAttribute("data-copied", "true")
	expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(" \n\t ")
	// Unmount while success feedback still owns a timer.
	await chooseView(page, "Runs Overview")
})

test("copy failure reports an alert and retry preserves draft and selection", async ({ desktop: { app, page } }) => {
	await page.getByRole("button", { name: "Launch", exact: true }).click()
	const reply = page.getByRole("textbox", { name: "Type your reply...", exact: true })
	await reply.fill(" retry\nthis ")
	await page.getByRole("button", { name: "Previous agent message", exact: true }).click()
	const before = await agentText(page).textContent()
	// Isolate the native clipboard boundary; the bridge and IPC validation remain real.
	await app.evaluate(({ clipboard }) => {
		Reflect.set(globalThis, "restoreClipboard", clipboard.writeText)
		clipboard.writeText = () => { throw new Error("Test clipboard unavailable") }
	})
	const copy = copyReplyButton(page)
	await copy.click()
	await expect(page.getByRole("alert")).toHaveText("Copy failed: Could not copy the user reply. Try again.")
	await expect(copy).toBeEnabled()
	await expect(reply).toHaveValue(" retry\nthis ")
	await expect(agentText(page)).toHaveText(before!)
	await app.evaluate(({ clipboard }) => { clipboard.writeText = Reflect.get(globalThis, "restoreClipboard") })
	await copy.click()
	await expect(copy).toHaveAttribute("data-copied", "true")
	expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(" retry\nthis ")
	await expect(reply).toHaveValue(" retry\nthis ")
	await expect(agentText(page)).toHaveText(before!)
})

for (const theme of ["dark", "light"]) {
	test(`history navigation opens messages at the top without resetting the draft in ${theme}`, async ({ desktop: { app, page } }) => {
		await app.evaluate(({ BrowserWindow }) => {
			const window = BrowserWindow.getAllWindows()[0]
			window.setContentSize(640, 420)
			window.webContents.setZoomFactor(1.25)
		})
		await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([512, 336])
		if (theme === "light") await page.getByRole("button", { name: "Toggle color theme" }).click()
		await page.getByRole("button", { name: "Launch", exact: true }).click()
		await page.evaluate(async () => { await document.fonts.ready })
		await waitForPanelLayout(page)
		const message = page.locator(".agent-hud__replyBox-scroll")
		const reply = page.getByRole("textbox", { name: "Type your reply...", exact: true })
		const draft = "Retained draft line\n".repeat(30)
		await reply.fill(draft)
		await reply.evaluate((element: HTMLTextAreaElement) => {
			element.setSelectionRange(2, 6)
			element.scrollTop = element.scrollHeight
			Reflect.set(window, "originalEditor", element)
		})
		const replyScroll = await reply.evaluate(element => element.scrollTop)
		expect(replyScroll).toBeGreaterThan(0)
		for (const [action, text] of [
			["Previous agent message", "Planning the next steps."],
			["Jump to latest agent message", "Mock run ready."],
			["Jump to first agent message", "Mock run created."],
			["Next agent message", "Planning the next steps."],
			["Jump to latest agent message", "Mock run ready."],
		]) {
			await message.evaluate(element => { element.scrollTop = element.scrollHeight })
			await expect.poll(() => message.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
			await page.getByRole("button", { name: action, exact: true }).click()
			await expect(message).toContainText(text)
			await expect.poll(() => message.evaluate(element => element.scrollTop)).toBe(0)
			await expect(reply).toHaveValue(draft)
			expect(await reply.evaluate((element: HTMLTextAreaElement) => [
				element === Reflect.get(window, "originalEditor"), element.scrollTop, element.selectionStart, element.selectionEnd,
			])).toEqual([true, replyScroll, 2, 6])
		}
	})

	test(`footer keeps mounted controls, focus, and feedback while wrapping in ${theme}`, async ({ desktop: { app, page } }) => {
		if (theme === "light") await page.getByRole("button", { name: "Toggle color theme" }).click()
		await page.getByRole("button", { name: "Launch", exact: true }).click()
		await page.getByRole("textbox", { name: "Type your reply...", exact: true }).fill("A local reply\nwith another line.")
		await page.getByRole("button", { name: "Previous agent message", exact: true }).click()
		await page.evaluate(async () => { await document.fonts.ready })
		expect(await page.evaluate(() => document.fonts.check('31px "Anurati Pro"'))).toBe(true)
		await page.clock.install()
		const copy = copyReplyButton(page)
		await copy.click()
		await expect(copy).toHaveAttribute("data-copied", "true")
		await page.clock.pauseAt(new Date())
		await copy.evaluate(element => Reflect.set(window, "originalCopy", element))
		const placements = new Set<string>()
		for (const width of [1260, 900, 760, 640, 760, 900, 1260]) {
			await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 780), width)
			await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
			await expectFooterGeometry(page, true)
			await expect(copy).toBeFocused()
			await expect(copy).toHaveAttribute("data-copied", "true")
			expect(await copy.evaluate(element => element === Reflect.get(window, "originalCopy"))).toBe(true)
			placements.add(await page.locator(".agent-hud__copy-controls").getAttribute("data-hud-action-placement") ?? "")
			const edges = await page.locator(".agent-hud__actions").evaluate(root => {
				const helpers = root.querySelector<HTMLElement>(".agent-hud__copy-controls")!
				return helpers.dataset.hudActionPlacement !== "primary" ||
					[".agent-hud__cancel", ".agent-hud__send"].every(selector => root.querySelector<HTMLElement>(selector)!.dataset.hudActionPlacement === "primary")
			})
			expect(edges).toBe(true)
		}
		expect([...placements].sort()).toEqual(["overflow", "primary"])
		await page.clock.resume()
		await copy.blur()
		const full = await captureNative(app, page, 1260, 780)
		const top = await page.locator(".agent-hud__replyBox--user").evaluate(panel => Math.floor(panel.getBoundingClientRect().top) - 4)
		const cropped = await app.evaluate(({ nativeImage }, { png, top }) =>
			nativeImage.createFromBuffer(Buffer.from(png, "base64")).crop({ x: 0, y: top, width: 1260, height: 780 - top }).toPNG().toString("base64"),
		{ png: full!.toString("base64"), top })
		expect(Buffer.from(cropped, "base64")).toMatchSnapshot(`footer-${theme}.png`, { threshold: 0.2, maxDiffPixelRatio: 0.002 })
	})
}

test("clipboard rejects invalid payloads and browser permissions stay denied", async ({ desktop: { app, page } }) => {
	await page.evaluate(() => window.robozium.writeClipboardText("clipboard sentinel"))
	for (const value of [null, 42, {}, ["text"], false]) {
		expect(await page.evaluate(async value => {
			try {
				await Reflect.apply(window.robozium.writeClipboardText, window.robozium, [value])
				return "allowed"
			} catch {
				return "denied"
			}
		}, value)).toBe("denied")
		expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe("clipboard sentinel")
	}
	expect(await page.evaluate(async () => {
		try {
			await navigator.clipboard.writeText("browser write")
			return "allowed"
		} catch {
			return "denied"
		}
	})).toBe("denied")
	expect(await page.evaluate(async () => {
		try {
			await navigator.clipboard.readText()
			return "allowed"
		} catch {
			return "denied"
		}
	})).toBe("denied")
	await page.evaluate(() => window.robozium.writeClipboardText(""))
	expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe("")
})

test("clipboard rejects other windows and documents without altering clipboard", async ({ desktop: { app, page } }) => {
	await page.evaluate(() => window.robozium.writeClipboardText("clipboard sentinel"))
	const result = await app.evaluate(async ({ BrowserWindow }, { preload, documentUrl }) => {
		const other = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false } })
		try {
			await other.loadURL(documentUrl)
			return await other.webContents.executeJavaScript(`(async () => {
				try {
					await window.robozium.writeClipboardText("untrusted")
					return "allowed"
				} catch {
					return "denied"
				}
			})()`)
		} finally { other.destroy() }
	}, { preload, documentUrl })
	expect(result).toBe("denied")
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].loadURL("about:blank"))
	expect(await page.evaluate(async () => {
		try {
			await window.robozium.writeClipboardText("untrusted")
			return "allowed"
		} catch {
			return "denied"
		}
	})).toBe("denied")
	expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe("clipboard sentinel")
})
