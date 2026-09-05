import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ThemeToggle } from "../../../../app/components/theme/ThemeToggle"
import {
	APP_THEME_CHANNEL_NAME,
	APP_THEME_COOKIE_NAME,
} from "../../../../lib/theme"

class MockBroadcastChannel {
	static instances: MockBroadcastChannel[] = []

	readonly name: string
	readonly postMessage = vi.fn()
	readonly close = vi.fn()
	private messageListener?: (event: MessageEvent<unknown>) => void

	constructor(name: string) {
		this.name = name
		MockBroadcastChannel.instances.push(this)
	}

	addEventListener(
		type: string,
		listener: (event: MessageEvent<unknown>) => void,
	) {
		if (type === "message") this.messageListener = listener
	}

	emit(data: unknown) {
		this.messageListener?.(new MessageEvent("message", { data }))
	}
}

beforeEach(() => {
	MockBroadcastChannel.instances = []
	vi.stubGlobal("BroadcastChannel", MockBroadcastChannel)
	document.documentElement.dataset.theme = "dark"
	document.documentElement.style.colorScheme = "dark"
	document.cookie = `${APP_THEME_COOKIE_NAME}=; Path=/; Max-Age=0`
})

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

describe("ThemeToggle", () => {
	it("switches the document theme and persists the selection", () => {
		render(<ThemeToggle />)

		fireEvent.click(screen.getByRole("button", { name: "Toggle color theme" }))
		expect(document.documentElement.dataset.theme).toBe("light")
		expect(document.documentElement.style.colorScheme).toBe("light")
		expect(document.cookie).toContain(`${APP_THEME_COOKIE_NAME}=light`)

		fireEvent.click(screen.getByRole("button", { name: "Toggle color theme" }))
		expect(document.documentElement.dataset.theme).toBe("dark")
		expect(document.documentElement.style.colorScheme).toBe("dark")
		expect(document.cookie).toContain(`${APP_THEME_COOKIE_NAME}=dark`)
		expect(MockBroadcastChannel.instances[0]?.postMessage).toHaveBeenLastCalledWith(
			"dark",
		)
	})

	it("follows valid theme changes broadcast by another tab", () => {
		render(<ThemeToggle />)

		const channel = MockBroadcastChannel.instances[0]
		expect(channel?.name).toBe(APP_THEME_CHANNEL_NAME)
		channel?.emit("light")

		expect(document.documentElement.dataset.theme).toBe("light")
		expect(document.documentElement.style.colorScheme).toBe("light")

		channel?.emit("invalid")
		expect(document.documentElement.dataset.theme).toBe("light")
	})
})
