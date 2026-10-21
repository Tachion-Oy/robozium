import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { HudMarkdown } from "@/app/components/hud/run/HudMarkdown"
import { AgentMessagePanel } from "@/app/components/hud/run/AgentMessagePanel"
import { useHudEscapeDismiss } from "@/hooks/useHudEscapeDismiss"

// jsdom has no native dialog lifecycle; real focus/inertness are covered in E2E.
beforeEach(() => {
	Object.defineProperties(HTMLDialogElement.prototype, {
		showModal: { configurable: true, value() { this.open = true } },
		close: { configurable: true, value() { this.open = false } },
	})
})
afterEach(() => {
	Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal")
	Reflect.deleteProperty(HTMLDialogElement.prototype, "close")
	vi.restoreAllMocks()
})

describe("HUD images", () => {
	it("renders local, remote, and sanitized HTML images alongside prose", () => {
		render(<HudMarkdown>{[
			"Before ![Chart](<projects/夏/my chart.png>) after.",
			"![Reference](https://example.com/image?size=large)",
			'<img src="projects/example/raw.png" alt="Raw" style="position:fixed" onerror="alert(1)" srcset="https://evil.test/other.png 2x" width="99999">',
		].join("\n\n")}</HudMarkdown>)
		expect(screen.getByRole("img", { name: "Chart" }).getAttribute("src")).toBe("/api/files/projects/%E5%A4%8F/my%20chart.png")
		expect(screen.getByRole("img", { name: "Reference" }).getAttribute("src")).toBe("https://example.com/image?size=large")
		const image = screen.getByRole("img", { name: "Raw" })
		for (const attribute of ["style", "onerror", "srcset", "width"]) expect(image.hasAttribute(attribute)).toBe(false)
		expect(image.getAttribute("referrerpolicy")).toBe("no-referrer")
		expect(screen.getByText(/Before/).textContent).toContain("after.")
	})

	it("does not request invalid sources and keeps their descriptions visible", () => {
		render(<HudMarkdown>{'![Bad](javascript:alert)\n\n<img src="../outside.png" alt="Outside">'}</HudMarkdown>)
		expect(screen.queryAllByRole("img")).toHaveLength(0)
		expect(screen.getByText("Bad — Image unavailable")).not.toBeNull()
		expect(screen.getByText("Outside — Image unavailable")).not.toBeNull()
		expect(screen.queryByRole("link")).toBeNull()
	})

	it("keeps a loaded image mounted while text streams and resets failures for a new source", () => {
		const { rerender } = render(<HudMarkdown>{"![Chart](projects/a.png)"}</HudMarkdown>)
		const image = screen.getByRole("img", { name: "Chart" })
		fireEvent.load(image)
		rerender(<HudMarkdown>{"![Chart](projects/a.png)\n\nMore text"}</HudMarkdown>)
		expect(screen.getByRole("img", { name: "Chart" })).toBe(image)
		expect(screen.queryByText("Loading image…")).toBeNull()
		fireEvent.error(image)
		expect(screen.getByRole("status").textContent).toContain("Image unavailable")
		expect(screen.getByRole("link", { name: "Open original" }).getAttribute("href")).toBe("/api/files/projects/a.png")
		rerender(<HudMarkdown>{"![Chart](projects/b.png)"}</HudMarkdown>)
		expect(screen.getByRole("img", { name: "Chart" }).getAttribute("src")).toBe("/api/files/projects/b.png")
	})

	it("preserves explicit image links without nesting interactive controls", () => {
		const { container } = render(<HudMarkdown>{"[![Chart](projects/chart.png)](https://example.com/report)"}</HudMarkdown>)
		expect(screen.getByRole("link").getAttribute("href")).toBe("https://example.com/report")
		expect(container.querySelector("a button, a a")).toBeNull()
		fireEvent.error(screen.getByRole("img"))
		expect(screen.getAllByRole("link")).toHaveLength(1)
	})

	it("opens the viewer, protects the HUD from Escape, and restores trigger focus", () => {
		const dismiss = vi.fn()
		function Run() {
			useHudEscapeDismiss(dismiss, true)
			return <HudMarkdown>{"![Chart](projects/chart.png)"}</HudMarkdown>
		}
		render(<Run />)
		const trigger = screen.getByRole("button", { name: "Expand Chart" })
		fireEvent.click(trigger)
		const dialog = screen.getByRole("dialog", { name: "Chart" })
		expect(screen.getByRole("link", { name: "Open original" }).getAttribute("href")).toBe("/api/files/projects/chart.png")
		const close = screen.getByRole("button", { name: "Close" })
		const original = screen.getByRole("link", { name: "Open original" })
		expect(document.activeElement).toBe(close)
		fireEvent.keyDown(close, { key: "Tab" })
		expect(document.activeElement).toBe(original)
		fireEvent.keyDown(original, { key: "Tab", shiftKey: true })
		expect(document.activeElement).toBe(close)
		fireEvent.keyDown(dialog, { key: "Escape" })
		expect(dismiss).not.toHaveBeenCalled()
		fireEvent(dialog, new Event("cancel"))
		expect(screen.queryByRole("dialog")).toBeNull()
		expect(document.activeElement).toBe(trigger)
		fireEvent.click(trigger)
		fireEvent.click(screen.getByRole("button", { name: "Close" }))
		expect(screen.queryByRole("dialog")).toBeNull()
	})

	it("closes the viewer when the selected message changes", () => {
		const message = { id: "one", content: "![Chart](projects/chart.png)", contentType: "markdown" as const, mode: "current" as const }
		const { rerender } = render(<AgentMessagePanel message={message} />)
		fireEvent.click(screen.getByRole("button", { name: "Expand Chart" }))
		rerender(<AgentMessagePanel message={{ ...message, content: `${message.content}\n\nMore text` }} />)
		expect(screen.getByRole("dialog")).not.toBeNull()
		rerender(<AgentMessagePanel message={{ ...message, id: "two" }} />)
		expect(screen.queryByRole("dialog")).toBeNull()
	})

	it("follows delayed image loads only during streaming", () => {
		const message = { id: "one", content: "![Chart](projects/chart.png)", contentType: "markdown" as const, mode: "streaming" as const }
		const { container, rerender } = render(<AgentMessagePanel message={message} />)
		const scroller = container.querySelector<HTMLElement>(".agent-hud__replyBox-scroll")!
		Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 300 })
		fireEvent.load(screen.getByRole("img"))
		expect(scroller.scrollTop).toBe(300)
		rerender(<AgentMessagePanel message={{ ...message, mode: "history" }} />)
		scroller.scrollTop = 42
		fireEvent.load(screen.getByRole("img"))
		expect(scroller.scrollTop).toBe(42)
	})
})
