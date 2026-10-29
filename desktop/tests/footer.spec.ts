import { expect } from "@playwright/test"
import type { Page } from "@playwright/test"
import { test, captureNative, chooseModel, chooseView, documentUrl, preload, previewMessages, waitForPanelLayout, reloadApp } from "./native"
import { expectFooterGeometry } from "./footer-geometry"

// The reference renames a copy button to "... copied" while it confirms, so
// these locate the buttons by position: agent output (top panel) first, user reply second.
const copyButtons = (page: Page) => page.locator(".agent-hud__copy-text:not(.agent-hud__clear-reply)")
const copyAgentButton = (page: Page) => copyButtons(page).nth(0)
const copyReplyButton = (page: Page) => copyButtons(page).nth(1)
const agentText = (page: Page) => page.locator(".agent-hud__replyBox--agent .agent-hud__replyBox-scroll")

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
	// One row: jump, step, indicator, step, jump, each as tall as the indicator; the image plus is square.
	const indicator = page.locator(".agent-hud__logo--actions")
	const [firstBox, previousBox, markBox, nextBox, latestBox, plusBox] = await Promise.all(
		[first, previous, indicator, next, latest, page.getByRole("button", { name: "Add images" })].map(async button => (await button.boundingBox())!))
	const row = [firstBox, previousBox, markBox, nextBox, latestBox]
	for (const [left, right] of row.slice(0, -1).map((box, index) => [box, row[index + 1]])) {
		expect(left.x + left.width).toBeLessThanOrEqual(right.x + 0.5)
	}
	for (const box of row) {
		expect(Math.abs(box.y + box.height / 2 - (markBox.y + markBox.height / 2))).toBeLessThan(0.5)
		expect(box.height).toBeGreaterThanOrEqual(markBox.height - 0.5)
	}
	expect(Math.abs(plusBox.width - plusBox.height)).toBeLessThan(0.5)
	await expect(next).toBeDisabled()
	await expect(latest).toBeDisabled()
	await expect(page.locator(".agent-hud__logo--actions")).toHaveAttribute("data-agent-state", "awaiting-input")
	// The run awaits a reply: it can be cancelled or dictated to, and Send waits for a draft.
	for (const name of ["Stop", "Record"]) await expect(footer.getByRole("button", { name, exact: true })).toBeEnabled()
	for (const name of ["Cancel", "Send"]) await expect(footer.getByRole("button", { name, exact: true })).toBeDisabled()
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
	const reply = page.getByRole("textbox", { name: "Reply text", exact: true })
	await reply.fill(" retained\n draft ")
	await page.getByRole("button", { name: "Move panel divider up" }).click()
	await chooseModel(page, "Mock extended context model")
	await page.getByRole("button", { name: "Toggle color theme" }).click()
	for (const name of ["Dependencies", "Environment", "Runs Overview"]) {
		await chooseView(page, name)
		await expect(footer).toHaveCount(0)
	}
	await page.getByRole("button", { name: "Open preview", exact: true }).click()
	await expect(message).toContainText("Planning the next steps.")
	await expect(reply).toHaveValue(" retained\n draft ")
	await expect(page.getByRole("group", { name: "Panel divider: equal" })).toBeVisible()
	// A reload keeps the backend's run but not the local draft or selection.
	await reloadApp(page)
	await page.getByRole("button", { name: "Open preview", exact: true }).click()
	await expect(message).toContainText("Mock run ready.")
	await expect(reply).toHaveValue("")
})

test("copy preserves exact text, expires feedback, clears stale feedback, and Clear keeps the same editor", async ({ desktop: { app, page } }) => {
	await page.getByRole("button", { name: "Launch", exact: true }).click()
	const reply = page.getByRole("textbox", { name: "Reply text", exact: true })
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
	// The agent's message is copied as the backend sent it, not as rendered.
	await copyAgent.click()
	await expect(copyAgent).toHaveAttribute("data-copied", "true")
	expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(previewMessages[2])
	await page.getByRole("button", { name: "Previous agent message", exact: true }).click()
	await expect(copyAgent).not.toHaveAttribute("data-copied")
	await copyAgent.click()
	await expect(copyAgent).toHaveAttribute("data-copied", "true")
	expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(previewMessages[1])
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
	const reply = page.getByRole("textbox", { name: "Reply text", exact: true })
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
	await expect(page.getByRole("alert").locator("p")).toHaveText(["Copy failed", "Could not copy the user reply.", "Try again."])
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
		const reply = page.getByRole("textbox", { name: "Reply text", exact: true })
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
		await page.getByRole("textbox", { name: "Reply text", exact: true }).fill("A local reply\nwith another line.")
		await page.getByRole("button", { name: "Previous agent message", exact: true }).click()
		await page.evaluate(async () => { await document.fonts.ready })
		await expect(page.locator(".agent-hud__logo--actions > .robozium-mark")).toBeVisible()
		// The screenshot tolerance cannot see a mark this small, so check that its mask
		// image loads under the renderer's CSP and has a size.
		expect(await page.evaluate(async () => {
			const mark = document.querySelector(".agent-hud__logo--actions > .robozium-mark")!
			const url = /url\("(.+)"\)/.exec(getComputedStyle(mark, "::before").maskImage)?.[1]
			if (!url) return null
			const image = new Image()
			image.src = url
			await image.decode()
			return image.naturalWidth > 0 && image.naturalHeight > 0
		})).toBe(true)
		await page.clock.install()
		const copy = copyReplyButton(page)
		await copy.click()
		await expect(copy).toHaveAttribute("data-copied", "true")
		// Pause just ahead of the page's own clock; the host time may already be behind it.
		await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 50)
		await copy.evaluate(element => Reflect.set(window, "originalCopy", element))
		const placements = new Set<string>()
		// At 100% the footer keeps one row down to the narrowest window; 125% reaches the wrap.
		const zoom = 1.25
		const setZoom = (factor: number) => app.evaluate(({ BrowserWindow }, factor) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(factor), factor)
		await setZoom(zoom)
		for (const width of [1260, 900, 700, 640, 700, 900, 1260]) {
			await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 780), width)
			await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width / zoom)
			await expectFooterGeometry(page, true)
			await expect(copy).toBeFocused()
			await expect(copy).toHaveAttribute("data-copied", "true")
			expect(await copy.evaluate(element => element === Reflect.get(window, "originalCopy"))).toBe(true)
			placements.add(await page.locator(".agent-hud__image").getAttribute("data-hud-action-placement") ?? "")
			// The copy buttons stay in the right edge's column, beneath the message log toggle.
			expect(await page.locator(".desktop-edge-controls").evaluate(column => {
				const toggle = column.querySelector(".desktop-message-log-toggle")!.getBoundingClientRect()
				const copies = [...column.querySelectorAll(".agent-hud__copy-controls button")].map(button => button.getBoundingClientRect())
				return copies.length === 3 && copies.every((rect, index) => rect.top >= (index ? copies[index - 1] : toggle).bottom
					&& Math.abs(rect.x + rect.width / 2 - toggle.x - toggle.width / 2) < 1)
			})).toBe(true)
			const edges = await page.locator(".agent-hud__actions").evaluate(root => {
				const image = root.querySelector<HTMLElement>(".agent-hud__image")!
				return image.dataset.hudActionPlacement !== "primary" ||
					[".agent-hud__cancel", ".agent-hud__send"].every(selector => root.querySelector<HTMLElement>(selector)!.dataset.hudActionPlacement === "primary")
			})
			expect(edges).toBe(true)
		}
		expect([...placements].sort()).toEqual(["overflow", "primary"])
		await setZoom(1)
		await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1260)
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
