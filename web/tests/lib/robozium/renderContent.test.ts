import { Fragment, createElement } from "react"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { StreamLogItemKind, StreamLogRole, type MessageLogItem } from "../../../lib/robozium/view-model"
import {
	EXPANDED_MESSAGE_MAX_CHARS,
	LIVE_MESSAGE_MAX_CHARS,
	cleanText,
	isMessageTruncated,
	messageRevealText,
	renderContent,
} from "../../../app/components/terminal/renderContent"

describe("cleanText", () => {
	it("replaces angle-bracket chunks and truncates long text", () => {
		const source = "<tool> " + "x".repeat(600)
		const cleaned = cleanText(source)
		expect(cleaned.startsWith("[tool] ")).toBe(true)
		expect(cleaned.endsWith("…")).toBe(true)
		expect(cleaned.length).toBe(500)
	})
})

describe("message display budgets", () => {
	const longMessage: MessageLogItem = {
		contentType: "markdown",
		kind: StreamLogItemKind.Message,
		role: StreamLogRole.System,
		content: "x".repeat(EXPANDED_MESSAGE_MAX_CHARS + 20),
	}

	it("keeps the live log compact and identifies omitted content", () => {
		const compact = messageRevealText(longMessage)
		expect(compact).toHaveLength(LIVE_MESSAGE_MAX_CHARS)
		expect(compact.endsWith("…")).toBe(true)
		expect(isMessageTruncated(longMessage)).toBe(true)
	})

	it("caps expanded messages at 4,000 characters", () => {
		const expanded = messageRevealText(longMessage, EXPANDED_MESSAGE_MAX_CHARS)
		expect(expanded).toHaveLength(EXPANDED_MESSAGE_MAX_CHARS)
		expect(expanded.endsWith("…")).toBe(true)
	})

	it("does not make complete messages interactive", () => {
		const shortMessage: MessageLogItem = {
			contentType: "markdown",
			kind: StreamLogItemKind.Message,
			role: StreamLogRole.System,
			content: "complete message",
		}
		expect(isMessageTruncated(shortMessage)).toBe(false)
	})
})

describe("renderContent", () => {
	it("renders assistant action as a tag and rationale as plain text", () => {
		const item: MessageLogItem = {
			contentType: "markdown",
			kind: StreamLogItemKind.Message,
			role: StreamLogRole.Agent,
			content: '{"action":"run_repo_command","rationale":"inspect tree"}',
			parsed: {
				kind: "assistant",
				action: "run_repo_command",
				rationale: "inspect tree",
				extra: {},
			},
		}
		render(createElement(Fragment, null, renderContent(item)))
		expect(screen.getByText("run_repo_command")).not.toBeNull()
		expect(screen.getByText("inspect tree")).not.toBeNull()
	})

	it("renders parsed extra values with glow emphasis in live mode", () => {
		const item: MessageLogItem = {
			contentType: "markdown",
			kind: StreamLogItemKind.Message,
			role: StreamLogRole.Tool,
			content: '{"caller":"run_repo_command","status":"ok","count":3}',
			parsed: {
				kind: "user",
				caller: "run_repo_command",
				extra: {
					status: "ok",
					count: 3,
				},
			},
		}
		render(createElement(Fragment, null, renderContent(item)))
		const highlighted = document.querySelectorAll(".term-emph")
		expect(highlighted.length).toBe(2)
		expect(document.body.textContent ?? "").toContain("status=ok")
		expect(document.body.textContent ?? "").toContain("count=3")
	})

	it("renders lifecycle started as banner-only without lifecycle row label", () => {
		render(
			createElement(
				Fragment,
				null,
				renderContent({
					kind: StreamLogItemKind.Lifecycle,
					role: StreamLogRole.Lifecycle,
					phase: "started",
					agentName: "robozium",
					startedAt: "2026-04-24T18:00:00.000Z",
					details: {
						kind: "started",
						agent_name: "robozium",
					},
				}),
			),
		)
		expect(screen.getByText("NEW PROCESS")).not.toBeNull()
		expect(screen.queryByText("LIFECYCLE")).toBeNull()
		expect(document.querySelector(".term-banner-logo")).toBeNull()
		expect(document.body.textContent ?? "").not.toContain(".o###o.")
	})

	it("renders lifecycle stopped as a banner event", () => {
		render(
			createElement(
				Fragment,
				null,
				renderContent({
					kind: StreamLogItemKind.Lifecycle,
					role: StreamLogRole.Lifecycle,
					phase: "stopped",
					agentName: "robozium",
					endedAt: "2026-04-24T18:02:00.000Z",
					status: "completed",
					details: {
						ended_at: "2026-04-24T18:02:00.000Z",
						kind: "stopped",
						status: "completed",
					},
				}),
			),
		)
		expect(screen.getByText("PROCESS STOPPED")).not.toBeNull()
		expect(screen.getByText("status")).not.toBeNull()
		expect(screen.getByText("completed")).not.toBeNull()
	})

	it("falls back to cleaned raw content when no parsed payload exists", () => {
		const item: MessageLogItem = {
			contentType: "markdown",
			kind: StreamLogItemKind.Message,
			role: StreamLogRole.System,
			content: "<raw>",
		}
		render(createElement(Fragment, null, renderContent(item)))
		expect(screen.getByText("[raw]")).not.toBeNull()
	})

	it("renders script output with a script badge", () => {
		const item: MessageLogItem = {
			contentType: "plain-text",
			kind: StreamLogItemKind.Message,
			role: StreamLogRole.Script,
			content: "script line",
		}
		render(createElement(Fragment, null, renderContent(item)))
		expect(screen.getByText("SCRIPT")).not.toBeNull()
		expect(screen.getByText("script line")).not.toBeNull()
	})

	it("renders parsed system payload value", () => {
		const item: MessageLogItem = {
			contentType: "markdown",
			kind: StreamLogItemKind.Message,
			role: StreamLogRole.System,
			content: "ignored-when-parsed",
			parsed: {
				kind: "system",
				value: "<sys-status>",
			},
		}
		render(createElement(Fragment, null, renderContent(item)))
		expect(screen.getByText("[sys-status]")).not.toBeNull()
	})

	it("renders parsed error payload value as plain text", () => {
		const item: MessageLogItem = {
			contentType: "markdown",
			kind: StreamLogItemKind.Message,
			role: StreamLogRole.Error,
			content: "bad {agent} output",
			parsed: {
				kind: "error",
				value: "bad {agent} output",
			},
		}
		render(createElement(Fragment, null, renderContent(item)))
		expect(document.body.textContent ?? "").toContain("bad {agent} output")
	})
})
