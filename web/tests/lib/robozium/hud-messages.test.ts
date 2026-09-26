import { describe, expect, it } from "vitest"
import { getHudMessages as selectHudMessages } from "../../../lib/robozium/hud-messages"
import { RunHudPhase, type HudMessage } from "../../../lib/robozium/session/reducer"

const getHudMessages = (messages: HudMessage[], selectedMessageId: string | null) =>
	selectHudMessages(messages, selectedMessageId, { phase: RunHudPhase.Passive, stream: null, prompt: null, promptId: null })

const notificationMessages: HudMessage[] = [
	{ contentType: "markdown",  id: "message-1", text: "First", replyId: null },
	{ contentType: "markdown",  id: "message-2", text: "Second", replyId: null },
]

describe("getHudMessages navigation", () => {
	it("derives first and latest endpoint states for the live view", () => {
		const { navigation } = getHudMessages(notificationMessages, null)

		expect(navigation.enabled).toEqual({
			first: true,
			previous: true,
			next: false,
			latest: false,
		})
	})

	it("enables endpoint jumps while browsing finalized notifications", () => {
		const { navigation, message } = getHudMessages(
			notificationMessages,
			"message-1",
		)

		expect(navigation.enabled).toEqual({
			first: false,
			previous: false,
			next: true,
			latest: true,
		})
		expect(message).toEqual({
			contentType: "markdown",
			id: "message:message-1",
			content: "First",
			mode: "history",
		})
	})

	it("treats the active prompt as the latest endpoint", () => {
		const messages: HudMessage[] = [
			...notificationMessages,
			{ contentType: "markdown",  id: "prompt-3", text: "Current prompt", replyId: "prompt-3" },
		]
		const { navigation, message } = getHudMessages(messages, "prompt-3")

		expect(navigation.enabled).toEqual({
			first: true,
			previous: true,
			next: false,
			latest: false,
		})
		expect(message?.mode).toBe("current")
	})
})
