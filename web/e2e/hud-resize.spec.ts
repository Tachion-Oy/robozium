import { expect, test } from "@playwright/test"
import { gotoLanding } from "./helpers"

let projectSlug: string | undefined

// Repetitions must not accumulate background Librarians from earlier runs.
test.afterEach(async ({ request }) => {
	if (projectSlug) {
		await request.post(`/api/projects/${encodeURIComponent(projectSlug)}/cancel`)
		projectSlug = undefined
	}
})

test.use({ viewport: { width: 1920, height: 1080 } })

test("keeps chosen size on run entry while content uses the available space", async ({
	page,
}) => {
	// This scenario covers landing, run resizing, both themes, zoom-equivalent
	// density, and mobile reset. Cold WebKit CI exhausted 60s at the final check;
	// give the whole flow room while retaining each action/assertion timeout.
	test.setTimeout(120_000)
	// This test asserts final geometry, not entrance animation timing. On loaded
	// CI runners the transform can still be in flight after a fixed wait, which
	// makes the two otherwise-equal gaps differ by several pixels.
	await page.emulateMedia({ reducedMotion: "reduce" })
	await gotoLanding(page)

	const box = page.locator(".agent-hud__box")
	const handle = page.getByRole("slider", { name: "Resize HUD" })
	const overviewSelector = page.getByRole("button", {
		name: "Runs Overview",
		exact: true,
	})
	await expect(handle).toBeVisible()
	await expect(handle).toHaveAttribute("aria-valuenow", "0")
	await expect(handle).toBeEnabled()
	await expect(page.locator(".agent-hud__corner-controls button")).toHaveCount(3)
	expect(
		await page
			.locator(".agent-hud__corner-controls button")
			.evaluateAll((buttons) =>
				buttons.every((button) => (button as HTMLButtonElement).disabled),
			),
	).toBe(true)
	await expect
		.poll(() => new URL(page.url()).searchParams.get("from"))
		.toBeNull()
	const landingUrl = page.url()

	const landingTable = page.locator(
		".agent-hud__project-view > .agent-hud__table-scroll",
	)
	const minimumTableBounds = await landingTable.boundingBox()
	expect(minimumTableBounds).not.toBeNull()
	const streamBands = await page.evaluate(() => {
		const hud = document.querySelector(".agent-hud__box")
		const log = document.querySelector(".term-log")
		if (!hud || !log) return null
		const hudBounds = hud.getBoundingClientRect()
		const logBounds = log.getBoundingClientRect()
		return {
			above: logBounds.top < hudBounds.top,
			below: logBounds.bottom > hudBounds.bottom,
		}
	})
	expect(streamBands).toEqual({ above: true, below: true })

	await handle.focus()
	await page.keyboard.press("End")
	await expect(handle).toHaveAttribute("aria-valuenow", "100")
	await expect
		.poll(async () => {
			const bounds = await landingTable.boundingBox()
			if (!bounds || !minimumTableBounds) return null
			return {
				width: bounds.width > minimumTableBounds.width,
				height: bounds.height > minimumTableBounds.height,
			}
		})
		.toEqual({ width: true, height: true })
	const maximumTableBounds = await landingTable.boundingBox()
	expect(maximumTableBounds).not.toBeNull()
	if (maximumTableBounds && minimumTableBounds) {
		expect(maximumTableBounds.width).toBeGreaterThan(minimumTableBounds.width)
		expect(maximumTableBounds.height).toBeGreaterThan(minimumTableBounds.height)
	}
	await page.keyboard.press("Home")
	await expect(handle).toHaveAttribute("aria-valuenow", "0")
	await expect
		.poll(async () => {
			const bounds = await landingTable.boundingBox()
			if (!bounds || !minimumTableBounds) return false
			return (
				Math.abs(bounds.width - minimumTableBounds.width) < 1 &&
				Math.abs(bounds.height - minimumTableBounds.height) < 1
			)
		})
		.toBe(true)

	await overviewSelector.click()
	await page.getByRole("option", { name: "Dependencies", exact: true }).click()
	const dependenciesSelector = page.getByRole("button", {
		name: "Dependencies",
		exact: true,
	})
	await expect(dependenciesSelector).toBeVisible()
	const dependencyTableScroll = page.locator(
		".agent-hud__status-view .agent-hud__table-scroll",
	)
	await expect(dependencyTableScroll).toBeVisible()
	expect(page.url()).toBe(landingUrl)
	await dependenciesSelector.click()
	await page.getByRole("option", { name: "Runs Overview", exact: true }).click()
	await expect(overviewSelector).toBeVisible()
	const minimumStatusBounds = await overviewSelector.boundingBox()
	expect(minimumStatusBounds).not.toBeNull()

	const gripBounds = await handle.boundingBox()
	expect(gripBounds).not.toBeNull()
	if (!gripBounds) return

	const gripCenter = {
		x: gripBounds.x + gripBounds.width / 2,
		y: gripBounds.y + gripBounds.height / 2,
	}
	const hitResizeHandle = await page.evaluate(
		({ x, y }) =>
			Boolean(
				document
					.elementFromPoint(x, y)
					?.closest(".agent-hud__resize-handle"),
			),
		gripCenter,
	)
	expect(hitResizeHandle).toBe(true)

	await page.mouse.move(
		gripCenter.x,
		gripCenter.y,
	)
	await page.mouse.down()
	await expect(box).toHaveClass(/agent-hud__box--resizing/)
	await page.mouse.move(
		gripCenter.x - 28,
		gripCenter.y + 28,
		{ steps: 4 },
	)
	await page.mouse.up()

	await expect
		.poll(async () => Number(await handle.getAttribute("aria-valuenow")))
		.toBeGreaterThan(0)
	const draggedProgress = Number(await handle.getAttribute("aria-valuenow"))
	expect(draggedProgress).toBeLessThanOrEqual(100)
	// Progress updates before WebKit commits the resulting layout.
	await expect.poll(async () => {
		const bounds = await overviewSelector.boundingBox()
		return Boolean(bounds && minimumStatusBounds &&
			bounds.x > minimumStatusBounds.x && bounds.y < minimumStatusBounds.y)
	}).toBe(true)

	await page.locator("button.agent-hud__start").click()
	projectSlug = `hud-resize-e2e-${Date.now()}`
	await page.getByLabel("Project name").fill(projectSlug)
	await page.getByRole("button", { name: "Create Project" }).click()
	await expect(page).toHaveURL(/[?&]runId=/, { timeout: 20_000 })
	await expect(page.locator(".agent-hud__textarea")).toBeVisible({
		timeout: 15_000,
	})
	await expect(page.getByRole("button", { name: "Minimize" })).toBeEnabled()
	await expect(page.locator(".app-nav__brand")).toHaveCount(0)
	await expect(
		page.getByRole("button", { name: "Current Run", exact: true }),
	).toBeVisible()
	await expect(handle).toHaveAttribute("aria-valuenow", String(draggedProgress))
	await handle.focus()
	await page.keyboard.press("End")
	await expect(handle).toHaveAttribute("aria-valuenow", "100")
	const runViewport = page.viewportSize()
	if (!runViewport) throw new Error("expected a fixed E2E viewport")
	await expect
		.poll(async () => {
			const bounds = await box.boundingBox()
			if (!bounds) return false
			return (
				Math.abs(bounds.width - runViewport.width * 0.78) < 2 &&
				Math.abs(bounds.height - runViewport.height * 0.84) < 2
			)
		})
		.toBe(true)
	const userPanel = page.locator(".agent-hud__replyBox--user")
	const waitForUserPanelTransition = () =>
		expect
			.poll(() =>
				userPanel.evaluate((element) => element.getAnimations().length),
			)
			.toBe(0)
	await waitForUserPanelTransition()
	const controlGaps = await page.evaluate(() => {
		const header = document.querySelector(".agent-hud__header--row")
		const upperPanel = document.querySelector(".agent-hud__replyBox--agent")
		const lowerPanel = document.querySelector(".agent-hud__replyBox--user")
		const actions = document.querySelector(".agent-hud__actions")
		if (!header || !upperPanel || !lowerPanel || !actions) return null
		const headerBounds = header.getBoundingClientRect()
		const upperBounds = upperPanel.getBoundingClientRect()
		const lowerBounds = lowerPanel.getBoundingClientRect()
		const actionBounds = actions.getBoundingClientRect()
		return {
			top: upperBounds.top - headerBounds.bottom,
			bottom: actionBounds.top - lowerBounds.bottom,
		}
	})
	expect(controlGaps).not.toBeNull()
	if (controlGaps) {
		expect(Math.abs(controlGaps.top - controlGaps.bottom)).toBeLessThan(2)
	}
	for (const theme of ["dark", "light"] as const) {
		await page.evaluate((nextTheme) => {
			document.documentElement.dataset.theme = nextTheme
		}, theme)
		const controlGeometry = await page.evaluate(() => {
			const box = document.querySelector<HTMLElement>(".agent-hud__box")
			const railButtons = Array.from(
				document.querySelectorAll<HTMLElement>(
					".agent-hud__corner-controls .agent-hud__corner-control",
				),
			)
			const resize = document.querySelector<HTMLElement>(
				".agent-hud__resize-wedge",
			)
			const actions = document.querySelector<HTMLElement>(
				".agent-hud__actions",
			)
			const navigation = document.querySelector<HTMLElement>(
				".agent-hud__message-nav",
			)
			const navigationLogo = document.querySelector<HTMLElement>(
				".agent-hud__logo--actions",
			)
			const navigationButtons = Array.from(
				document.querySelectorAll<HTMLElement>(
					".agent-hud__message-direction",
				),
			)
			const upper = document.querySelector<HTMLElement>(
				".agent-hud__replyBox--agent",
			)
			const lower = document.querySelector<HTMLElement>(
				".agent-hud__replyBox--user",
			)
			const replySection = document.querySelector<HTMLElement>(
				".agent-hud__replySection",
			)
			if (
				!box ||
				!resize ||
				!actions ||
				!navigation ||
				!navigationLogo ||
				!upper ||
				!lower ||
				!replySection
			)
				return null
			const controls = [...railButtons, resize].map((control) => {
				const bounds = control.getBoundingClientRect()
				return {
					width: bounds.width,
					height: bounds.height,
					centerX: bounds.left + bounds.width / 2,
					left: bounds.left,
					right: bounds.right,
					top: bounds.top,
					bottom: bounds.bottom,
				}
			})
			const boxBounds = box.getBoundingClientRect()
			const lightInnerRail =
				document.documentElement.dataset.theme === "light"
					? Number.parseFloat(
							getComputedStyle(document.documentElement).fontSize,
						) * 0.68
					: 0
			const actionsBounds = actions.getBoundingClientRect()
			const navigationBounds = navigation.getBoundingClientRect()
			const navigationLogoBounds = navigationLogo.getBoundingClientRect()
			const lowerBounds = lower.getBoundingClientRect()
			const submitButtons = Array.from(
				document.querySelectorAll<HTMLButtonElement>(
					".agent-hud__actions-submit button",
				),
			)
			return {
				controls,
				leftGutter: {
					left: boxBounds.left + lightInnerRail,
					right: lowerBounds.left,
				},
				stackCenterOffset: Math.abs(
					boxBounds.top + boxBounds.height / 2 -
						(controls[0].top + controls.at(-1)!.bottom) / 2,
				),
				navigationOffset: Math.abs(
					actionsBounds.left + actionsBounds.width / 2 -
						(navigationBounds.left + navigationBounds.width / 2),
				),
				navigationVerticalOffsets: navigationButtons.map((button) => {
					const bounds = button.getBoundingClientRect()
					return Math.abs(
						bounds.top + bounds.height / 2 -
							(navigationLogoBounds.top + navigationLogoBounds.height / 2),
					)
				}),
				navigationLogoHeight: navigationLogoBounds.height,
				navigationButtonHeights: navigationButtons.map(
					(button) => button.getBoundingClientRect().height,
				),
				replyOverflow: getComputedStyle(replySection).overflow,
				panelGap:
					lower.getBoundingClientRect().top -
					upper.getBoundingClientRect().bottom,
				copyOrder: submitButtons.map(
					(button) => button.getAttribute("aria-label") ?? button.textContent,
				),
				submitHeights: submitButtons.map(
					(button) => button.getBoundingClientRect().height,
				),
			}
		})
		expect(controlGeometry).not.toBeNull()
		if (!controlGeometry) continue
		expect(controlGeometry.controls).toHaveLength(4)
		for (const control of controlGeometry.controls) {
			expect(control.width).toBeCloseTo(controlGeometry.controls[0].width, 1)
			expect(control.height).toBeCloseTo(controlGeometry.controls[0].height, 1)
			expect(control.centerX).toBeCloseTo(
				controlGeometry.controls[0].centerX,
				1,
			)
			expect(control.left).toBeGreaterThan(controlGeometry.leftGutter.left)
			expect(control.right).toBeLessThan(controlGeometry.leftGutter.right)
			expect(
				Math.abs(
					control.centerX -
						(controlGeometry.leftGutter.left +
							controlGeometry.leftGutter.right) /
							2,
				),
			).toBeLessThan(1)
		}
		expect(controlGeometry.controls.map(({ top }) => top)).toEqual(
			controlGeometry.controls.map(({ top }) => top).toSorted((a, b) => a - b),
		)
		const verticalGaps = controlGeometry.controls.slice(1).map(
			(control, index) =>
				control.top - controlGeometry.controls[index].bottom,
		)
		for (const gap of verticalGaps) {
			expect(gap).toBeGreaterThanOrEqual(0)
			expect(Math.abs(gap - verticalGaps[0])).toBeLessThan(0.1)
		}
		expect(controlGeometry.stackCenterOffset).toBeLessThan(1)
		expect(controlGeometry.navigationOffset).toBeLessThan(1)
		for (const offset of controlGeometry.navigationVerticalOffsets) {
			expect(offset).toBeLessThan(1)
		}
		for (const height of controlGeometry.navigationButtonHeights) {
			expect(controlGeometry.navigationLogoHeight).toBeCloseTo(height, 1)
		}
		expect(controlGeometry.replyOverflow).toBe("visible")
		expect(controlGeometry.panelGap).toBeGreaterThan(0)
		expect(controlGeometry.panelGap).toBeLessThan(15)
		expect(controlGeometry.copyOrder).toEqual([
			"Clear reply",
			"Copy user reply",
			"Copy agent output",
			"Record",
			"Send",
		])
		for (const height of controlGeometry.submitHeights) {
			expect(height).toBeCloseTo(controlGeometry.submitHeights[0], 1)
		}

		await expect(page.locator(".agent-hud__panels")).toHaveAttribute(
			"data-layout",
			"top",
		)
		await waitForUserPanelTransition()
		const compactComposer = await page.locator(".agent-hud__textarea").evaluate(
			(element) => {
				const bounds = element.getBoundingClientRect()
				const panelBounds = element
					.closest(".agent-hud__replyBox")
					?.getBoundingClientRect()
				const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight)
				return {
					lineCapacity: bounds.height / lineHeight,
					top: panelBounds?.top ?? bounds.top,
					bottom: panelBounds?.bottom ?? bounds.bottom,
					height: panelBounds?.height ?? bounds.height,
				}
			},
		)
		expect(compactComposer.lineCapacity).toBeGreaterThanOrEqual(4)
		await page.getByRole("button", { name: "Move panel divider up" }).click()
		await expect(page.locator(".agent-hud__panels")).toHaveAttribute(
			"data-layout",
			"equal",
		)
		await waitForUserPanelTransition()
		const expandedComposer = await userPanel.evaluate(
			(element) => {
				const bounds = element.getBoundingClientRect()
				return { top: bounds.top, bottom: bounds.bottom }
			},
		)
		expect(expandedComposer.top).toBeLessThan(compactComposer.top)
		expect(
			Math.abs(expandedComposer.bottom - compactComposer.bottom),
		).toBeLessThan(1)
		await page.getByRole("button", { name: "Move panel divider down" }).click()
		await expect(page.locator(".agent-hud__panels")).toHaveAttribute(
			"data-layout",
			"top",
		)
		await waitForUserPanelTransition()
		const restoredComposer = await userPanel.boundingBox()
		expect(restoredComposer).not.toBeNull()
		if (restoredComposer) {
			expect(
				Math.abs(restoredComposer.height - compactComposer.height),
			).toBeLessThan(1)
			expect(
				Math.abs(
					restoredComposer.y +
						restoredComposer.height -
						compactComposer.bottom,
				),
			).toBeLessThan(1)
		}
	}
	await page.evaluate(() => {
		document.documentElement.dataset.theme = "dark"
	})

	// The user selected the wide size above. The minimized
	// widget is a separate control.
	await expect(handle).toHaveAttribute("aria-valuenow", "100")
	await expect(
		page.locator(".agent-hud__actions .agent-hud__expand"),
	).toHaveCount(0)

	await handle.focus()
	await page.keyboard.press("End")
	await expect(handle).toHaveAttribute("aria-valuenow", "100")

	const expectedMaximum = await page.evaluate(() => {
		return {
			width: window.innerWidth * 0.78,
			height: window.innerHeight * 0.84,
		}
	})
	await page.waitForTimeout(250)
	const maximumSize = await box.evaluate((element) => {
		const style = (element as HTMLElement).style
		return {
			width: Number.parseFloat(style.width),
			height: Number.parseFloat(style.height),
		}
	})
	expect(Math.abs(maximumSize.width - expectedMaximum.width)).toBeLessThan(2)
	expect(Math.abs(maximumSize.height - expectedMaximum.height)).toBeLessThan(2)

	await page.reload()
	await expect(handle).toBeVisible({ timeout: 15_000 })
	await expect(handle).toHaveAttribute("aria-valuenow", "0")
	await page.waitForTimeout(250)
	for (const theme of ["dark", "light"] as const) {
		await page.evaluate((nextTheme) => {
			document.documentElement.dataset.theme = nextTheme
		}, theme)
		const compactActionGeometry = await page.evaluate(() => {
			const navigation = document.querySelector<HTMLElement>(
				".agent-hud__message-nav",
			)
			const submit = document.querySelector<HTMLElement>(
				".agent-hud__actions-submit",
			)
			const copyButtons = Array.from(
				document.querySelectorAll<HTMLElement>(
					".agent-hud__copy-controls button",
				),
			)
			const record = document.querySelector<HTMLElement>(
				".agent-hud__dictate",
			)
			const send = document.querySelector<HTMLElement>(".agent-hud__send")
			if (!navigation || !submit || !record || !send || !copyButtons.length) {
				return null
			}
			const navigationBounds = navigation.getBoundingClientRect()
			const submitBounds = submit.getBoundingClientRect()
			const recordBounds = record.getBoundingClientRect()
			const sendBounds = send.getBoundingClientRect()
			const copyBounds = copyButtons.map((button) =>
				button.getBoundingClientRect(),
			)
			const recordStyle = getComputedStyle(record)
			return {
				navigationClearance: submitBounds.left - navigationBounds.right,
				largeButtonGap: sendBounds.left - recordBounds.right,
				copyAspectRatios: copyBounds.map(
					(bounds) => bounds.width / bounds.height,
				),
				recordWidth: recordBounds.width,
				recordMinWidth: Number.parseFloat(recordStyle.minWidth),
				recordMaxWidth: Number.parseFloat(recordStyle.maxWidth),
			}
		})
		expect(compactActionGeometry).not.toBeNull()
		if (!compactActionGeometry) continue
		expect(compactActionGeometry.navigationClearance).toBeGreaterThanOrEqual(
			compactActionGeometry.largeButtonGap,
		)
		if (theme === "light") {
			for (const ratio of compactActionGeometry.copyAspectRatios) {
				expect(ratio).toBeLessThan(0.9)
			}
		}
		expect(compactActionGeometry.recordWidth).toBeCloseTo(
			compactActionGeometry.recordMinWidth,
			1,
		)
		expect(compactActionGeometry.recordWidth).toBeCloseTo(
			compactActionGeometry.recordMaxWidth,
			1,
		)
		const recordingGeometry = await page.evaluate(() => {
			const record = document.querySelector<HTMLElement>(
				".agent-hud__dictate",
			)
			const label = record?.querySelector<HTMLElement>(":scope > span")
			if (!record || !label) return null

			record.setAttribute("aria-pressed", "true")
			record.dataset.dictationState = "recording"
			label.textContent = "Stop"
			const meter = document.createElement("span")
			meter.className = "agent-hud__dictate-meter"
			for (let index = 0; index < 7; index += 1) {
				const segment = document.createElement("span")
				segment.className = "agent-hud__dictate-meter-segment"
				segment.dataset.active = ""
				meter.append(segment)
			}
			record.append(meter)

			const recordBounds = record.getBoundingClientRect()
			const labelBounds = label.getBoundingClientRect()
			const meterBounds = meter.getBoundingClientRect()
			const geometry = {
				leftInset: labelBounds.left - recordBounds.left,
				rightInset: recordBounds.right - meterBounds.right,
				recordingWidth: recordBounds.width,
			}

			meter.remove()
			record.setAttribute("aria-pressed", "false")
			record.dataset.dictationState = "idle"
			label.textContent = "Record"
			return geometry
		})
		expect(recordingGeometry).not.toBeNull()
		if (recordingGeometry) {
			expect(
				Math.abs(
					recordingGeometry.leftInset - recordingGeometry.rightInset,
				),
			).toBeLessThan(1)
			expect(recordingGeometry.recordingWidth).toBeCloseTo(
				compactActionGeometry.recordWidth,
				1,
			)
		}
	}
	await page.evaluate(() => {
		document.documentElement.dataset.theme = "dark"
	})
	await handle.click()
	await expect(handle).toHaveAttribute("aria-valuenow", "100")

	// A 1200 x 675 CSS viewport approximates the layout space available when a
	// 1920 x 1080 desktop browser is zoomed to 160%. The compact desktop density
	// must keep the complete run HUD and its controls inside that viewport.
	await page.setViewportSize({ width: 1200, height: 675 })
	await expect(box).toBeVisible()
	await expect
		.poll(() =>
			box.evaluate((element) => {
				const bounds = element.getBoundingClientRect()
				return bounds.top >= 0 && bounds.bottom <= window.innerHeight
			}),
		)
		.toBe(true)
	const zoomEquivalentLayout = await page.evaluate(() => {
		const viewport = { width: window.innerWidth, height: window.innerHeight }
		const selectors = [
			".agent-hud__box",
			".agent-hud__replyBox--agent",
			".agent-hud__replyBox--user",
			".agent-hud__actions",
		]
		return {
			rootFontSize: Number.parseFloat(
				getComputedStyle(document.documentElement).fontSize,
			),
			bounds: selectors.map((selector) => {
				const element = document.querySelector(selector)
				if (!element) return null
				const rect = element.getBoundingClientRect()
				return {
					left: rect.left,
					top: rect.top,
					right: rect.right,
					bottom: rect.bottom,
				}
			}),
			viewport,
		}
	})
	expect(zoomEquivalentLayout.rootFontSize).toBeCloseTo(12, 1)
	for (const bounds of zoomEquivalentLayout.bounds) {
		expect(bounds).not.toBeNull()
		if (!bounds) continue
		expect(bounds.left).toBeGreaterThanOrEqual(0)
		expect(bounds.top).toBeGreaterThanOrEqual(0)
		expect(bounds.right).toBeLessThanOrEqual(
			zoomEquivalentLayout.viewport.width,
		)
		expect(bounds.bottom).toBeLessThanOrEqual(
			zoomEquivalentLayout.viewport.height,
		)
	}

	await gotoLanding(page)
	await expect(handle).toHaveAttribute("aria-valuenow", "0")

	await page.setViewportSize({ width: 640, height: 800 })
	await expect
		.poll(() =>
			page.evaluate(() => ({
				fontSize: Number.parseFloat(
					getComputedStyle(document.documentElement).fontSize,
				),
				scale: Number.parseFloat(
					getComputedStyle(document.documentElement).getPropertyValue(
						"--app-ui-scale",
					),
				),
			})),
		)
		.toEqual({ fontSize: 16, scale: 1 })
})
