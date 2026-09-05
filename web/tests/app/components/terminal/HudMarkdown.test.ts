import { createElement } from "react"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { HudMarkdown } from "../../../../app/components/terminal/HudMarkdown"

describe("HudMarkdown", () => {
	it("keeps a table mounted when unchanged markdown rerenders", () => {
		const markdown = "| First | Second |\n| --- | --- |\n| one | two |"
		const { container, rerender } = render(
			createElement(HudMarkdown, null, markdown),
		)
		const scroller = container.querySelector(
			".agent-hud__markdown-table-scroll",
		) as HTMLDivElement
		scroller.scrollLeft = 120

		rerender(createElement(HudMarkdown, null, markdown))

		expect(
			container.querySelector(".agent-hud__markdown-table-scroll"),
		).toBe(scroller)
		expect(scroller.scrollLeft).toBe(120)
	})

	it("renders ordinary markdown content", () => {
		render(
			createElement(HudMarkdown, null, "## Heading\n\n- one\n- two\n\n`inline`"),
		)

		expect(screen.getByRole("heading", { name: "Heading" })).not.toBeNull()
		expect(screen.getByRole("list")).not.toBeNull()
		expect(screen.getByText("inline").tagName).toBe("CODE")
	})

	it("renders direct Unicode content", () => {
		render(
			createElement(
				HudMarkdown,
				null,
				"| Status |\n| --- |\n| 🟡 Drafting |",
			),
		)

		expect(screen.getByText("🟡 Drafting")).not.toBeNull()
	})

	it("recovers literal JSON Unicode escapes in prose and tables", () => {
		const markdown = String.raw`| Posting | Rate |
| --- | --- |
| Fullstack-kehitt\u00e4j\u00e4 | 75\u201385 \u20ac/h |

Aug 29 \u2192 Aug 31`
		render(createElement(HudMarkdown, null, markdown))

		expect(screen.getByText("Fullstack-kehittäjä")).not.toBeNull()
		expect(screen.getByText("75–85 €/h")).not.toBeNull()
		expect(screen.getByText("Aug 29 → Aug 31")).not.toBeNull()
		expect(screen.queryByText(/\\u00e4/)).toBeNull()
	})

	it("recovers escaped surrogate pairs and joiners", () => {
		render(
			createElement(
				HudMarkdown,
				null,
				String.raw`Developer: \ud83d\udc69\u200d\ud83d\udcbb`,
			),
		)

		expect(screen.getByText("Developer: 👩‍💻")).not.toBeNull()
	})

	it("preserves Unicode escape examples in inline and fenced code", () => {
		const markdown = [
			"Inline: `\\u00e4`",
			"",
			"```text",
			"\\ud83d\\ude80",
			"```",
		].join("\n")
		const { container } = render(createElement(HudMarkdown, null, markdown))

		expect(screen.getByText("\\u00e4").tagName).toBe("CODE")
		expect(container.querySelector("pre")?.textContent).toBe("\\ud83d\\ude80\n")
	})

	it("leaves malformed, isolated, and doubled escapes untouched", () => {
		const markdown = String.raw`Malformed: \u12; high: \ud83d; low: \ude80; doubled: \\\\u00e4`
		render(createElement(HudMarkdown, null, markdown))

		expect(
			screen.getByText(
				String.raw`Malformed: \u12; high: \ud83d; low: \ude80; doubled: \\u00e4`,
			),
		).not.toBeNull()
	})

	it("keeps decoded markup-looking escapes inert", () => {
		const { container } = render(
			createElement(
				HudMarkdown,
				null,
				String.raw`\u003cscript\u003ealert("xss")\u003c/script\u003e`,
			),
		)

		expect(container.querySelector("script")).toBeNull()
		expect(screen.getByText('<script>alert("xss")</script>')).not.toBeNull()
	})

	it("renders blockquote content instead of dropping it", () => {
		render(createElement(HudMarkdown, null, "> quoted ad text"))

		expect(screen.getByText("quoted ad text")).not.toBeNull()
	})

	it("renders external http links with safe attributes", () => {
		render(
			createElement(HudMarkdown, null, "[Docs](https://example.com/docs)"),
		)

		const link = screen.getByRole("link", { name: "Docs" })
		expect(link.getAttribute("href")).toBe("https://example.com/docs")
		expect(link.getAttribute("target")).toBe("_blank")
		expect(link.getAttribute("rel")).toBe("noreferrer")
	})

	it("renders custom file tags as proxied file links", () => {
		render(
			createElement(
				HudMarkdown,
				null,
				'<file src="projects/alice-cv/documents/cv-updated.pdf">Open CV</file>',
			),
		)

		const link = screen.getByRole("link", { name: "Open CV" })
		expect(link.getAttribute("href")).toBe(
			"/api/files/projects/alice-cv/documents/cv-updated.pdf",
		)
		expect(link.getAttribute("target")).toBe("_blank")
		expect(link.getAttribute("rel")).toBe("noreferrer")
	})

	it("drops invalid custom file tag paths", () => {
		render(
			createElement(
				HudMarkdown,
				null,
				'<file src="../secrets.txt">Invalid file link</file>',
			),
		)

		expect(screen.queryByRole("link", { name: "Invalid file link" })).toBeNull()
		expect(screen.getByText("Invalid file link")).not.toBeNull()
	})

	it("drops unsupported link schemes", () => {
		render(
			createElement(HudMarkdown, null, "[Ignore this](javascript:alert('xss'))"),
		)

		expect(screen.queryByRole("link", { name: "Ignore this" })).toBeNull()
		expect(screen.getByText("Ignore this")).not.toBeNull()
	})

	it("strips disallowed raw html elements", () => {
		render(
			createElement(
				HudMarkdown,
				null,
				'Before<script>alert("xss")</script><img src="x" alt="Bad image" />After',
			),
		)

		expect(screen.queryByRole("img", { name: "Bad image" })).toBeNull()
		expect(screen.queryByText('alert("xss")')).toBeNull()
		expect(screen.getByText("BeforeAfter")).not.toBeNull()
	})
})
