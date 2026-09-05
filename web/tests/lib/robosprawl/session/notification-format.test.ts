import { describe, expect, it } from "vitest"
import {
	formatNotification,
	shouldToast,
} from "../../../../lib/robosprawl/session/notification-format"
import type { RuntimeErrorNotification } from "../../../../lib/robosprawl/session/reducer.types"

function llmNotification(
	errorKind: string | undefined,
	overrides: Partial<RuntimeErrorNotification> = {},
): RuntimeErrorNotification {
	return {
		id: "run-1:1",
		category: "llm",
		kind: "failed",
		level: "error",
		message: "raw provider error text",
		agentName: "root",
		data: errorKind === undefined ? null : { error_kind: errorKind },
		...overrides,
	}
}

describe("formatNotification", () => {
	it("shows the backend message as-is for llm errors", () => {
		const formatted = formatNotification(llmNotification("auth"))
		expect(formatted.title).toBe("LLM call failed")
		expect(formatted.message).toBe("raw provider error text")
		expect(formatted.tone).toBe("error")
	})

	it("uses warning tone for recoverable llm failures", () => {
		const formatted = formatNotification(
			llmNotification("auth", { level: "warning" }),
		)

		expect(formatted.tone).toBe("warning")
	})

	it("carries endpoint/model as the detail line when present", () => {
		const formatted = formatNotification(
			llmNotification("auth", {
				data: { error_kind: "auth", endpoint: "openrouter", model: "gpt-x" },
			}),
		)
		expect(formatted.detail).toBe("openrouter/gpt-x")
	})

	it("omits the detail line when endpoint/model are missing", () => {
		const formatted = formatNotification(llmNotification(undefined))
		expect(formatted.detail).toBeNull()
	})

	it("truncates a long message", () => {
		const longMessage = "x".repeat(300)
		const formatted = formatNotification(
			llmNotification("auth", { message: longMessage }),
		)
		expect(formatted.message.length).toBeLessThanOrEqual(201)
		expect(formatted.message.endsWith("…")).toBe(true)
	})

	it("maps stream category to a connection problem", () => {
		const formatted = formatNotification({
			id: "run-1:stream:failed:x",
			category: "stream",
			kind: "failed",
			level: "error",
			message: "stream request failed (503)",
			agentName: "system",
			data: null,
		})
		expect(formatted.title).toBe("Connection problem")
		expect(formatted.message).toBe("stream request failed (503)")
	})

	it("falls back to category-based title for other categories", () => {
		const formatted = formatNotification({
			id: "run-1:2",
			category: "tool",
			kind: "timeout",
			level: "error",
			message: "tool timed out",
			agentName: "root",
			data: null,
		})
		expect(formatted.title).toBe("tool error")
		expect(formatted.message).toBe("tool timed out")
	})
})

describe("shouldToast", () => {
	it.each(["cancelled", "interrupted"])(
		"returns false for user-initiated llm error_kind %s",
		(errorKind) => {
			expect(shouldToast(llmNotification(errorKind))).toBe(false)
		},
	)

	it("returns true for other llm error kinds", () => {
		expect(shouldToast(llmNotification("auth"))).toBe(true)
	})

	it("returns true when error_kind is missing", () => {
		expect(shouldToast(llmNotification(undefined))).toBe(true)
	})

	it.each(["cancelled", "interrupted"])(
		"returns false for user-initiated tool kind %s",
		(kind) => {
			expect(
				shouldToast({
					id: `run-1:tool:${kind}:x`,
					category: "tool",
					kind,
					level: "warning",
					message: `Tool call ${kind}`,
					agentName: "root",
					data: { tool: "example" },
				}),
			).toBe(false)
		},
	)

	it("returns true for non-llm failures", () => {
		expect(
			shouldToast({
				id: "run-1:stream:failed:x",
				category: "stream",
				kind: "failed",
				level: "error",
				message: "boom",
				agentName: "system",
				data: null,
			}),
		).toBe(true)
	})
})
