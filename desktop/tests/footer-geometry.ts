import { expect, type Page } from "@playwright/test"

export async function expectFooterGeometry(page: Page, advanceClock = false) {
	await expect.poll(async () => {
		// ResizeObserver schedules placement on an animation frame. Keep those
		// frames moving when a test freezes the two-second clipboard timer.
		if (advanceClock) await page.clock.runFor(50)
		return page.locator(".agent-hud__actions").evaluate(footer => {
			const bounds = footer.getBoundingClientRect()
			const navigation = footer.querySelector(".agent-hud__message-nav")!.getBoundingClientRect()
			const buttons = [...footer.querySelectorAll("button")]
			const rectangles = buttons.map(button => button.getBoundingClientRect())
			const icons = buttons.flatMap(button => {
				const icon = button.querySelector("svg")
				if (!icon) return []
				const a = button.getBoundingClientRect(), b = icon.getBoundingClientRect()
				// The message arrows line up on the edge nearest the indicator instead.
				const inside = button.classList.contains("agent-hud__message-direction")
					? b.x >= a.x && b.right <= a.right
					: Math.abs(a.x + a.width / 2 - b.x - b.width / 2) < 1
				return [inside
					&& Math.abs(a.y + a.height / 2 - b.y - b.height / 2) < 1
					// Not collapsed: the image plus is as small as a capital letter (about 9 px at 1x).
					&& b.width > 6 && b.height > 6]
			})
			return {
				centered: Math.abs(navigation.x + navigation.width / 2 - innerWidth / 2) < 1,
				contained: rectangles.every(rect => rect.x >= bounds.x - 1 && rect.right <= bounds.right + 1
					&& rect.y >= bounds.y - 1 && rect.bottom <= bounds.bottom + 1),
				separated: rectangles.every((a, i) => rectangles.slice(i + 1).every(b =>
					a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1)),
				iconsCentered: icons.every(Boolean),
				labelsFit: buttons.every(button => button.scrollWidth <= button.clientWidth),
				belowPanels: bounds.top >= document.querySelector(".agent-hud__panels")!.getBoundingClientRect().bottom,
				noOverflow: document.documentElement.scrollWidth === innerWidth && document.documentElement.scrollHeight === innerHeight,
			}
		})
	}).toEqual({ centered: true, contained: true, separated: true, iconsCentered: true, labelsFit: true, belowPanels: true, noOverflow: true })
}
