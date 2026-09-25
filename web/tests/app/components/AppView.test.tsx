import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { hudVisibilityStore } from "../../../lib/robozium/hud-visibility"

const mocks = vi.hoisted(() => ({ shouldReturnHome: false }))

vi.mock("../../../hooks/useRunNotifications", () => ({
	useRunNotifications: () => {},
}))
vi.mock("../../../hooks/useRunSession", () => ({
	RunSessionProvider: ({ children }: { children: ReactNode }) => children,
	useRunSessionSelector: (_selector: unknown, fallback: unknown) =>
		typeof fallback === "boolean" ? mocks.shouldReturnHome : fallback,
}))
vi.mock("../../../app/components/terminal/TerminalFrame", () => ({
	TerminalFrame: ({ children }: { children: ReactNode }) => children,
}))
vi.mock("../../../app/components/terminal/TerminalRunView", () => ({
	TerminalRunView: ({
		runId,
		playIntro,
	}: {
		runId: string | null
		playIntro: boolean
	}) => (
		<div>{runId ? "session transcript" : playIntro ? "intro" : "placeholder"}</div>
	),
}))
vi.mock("../../../app/components/hud/AgentHUD", () => ({ AgentHUD: () => null }))

import { AppView } from "../../../app/components/AppView"

beforeEach(() => {
	vi.clearAllMocks()
	mocks.shouldReturnHome = false
	hudVisibilityStore.setState({ navigationPending: false })
	window.history.replaceState(null, "", "/")
})
afterEach(() => cleanup())

const props = {
	error: null,
	from: null,
	modelSelectionPromise: Promise.resolve(null),
}

describe("AppView landing intro", () => {
	it("does not replay after leaving and returning in the same client runtime", () => {
		const first = render(<AppView {...props} runId={null} />)
		expect(screen.getByText("intro")).not.toBeNull()
		first.unmount()
		render(<AppView {...props} runId={null} />)
		expect(screen.getByText("placeholder")).not.toBeNull()
	})
})

describe("AppView run completion navigation", () => {
	it("keeps an active run on its current route", () => {
		window.history.replaceState(null, "", "/?runId=run-1")
		render(<AppView {...props} runId="run-1" />)
		expect(window.location.search).toBe("?runId=run-1")
	})

	it("replaces a terminal run URL and retains its transcript in the client view", async () => {
		window.history.replaceState(null, "", "/?runId=run-1")
		const replaceState = vi.spyOn(window.history, "replaceState")
		mocks.shouldReturnHome = true
		const view = render(<AppView {...props} runId="run-1" />)
		await waitFor(() => expect(window.location.pathname + window.location.search).toBe("/"))
		expect(screen.getByText("session transcript")).not.toBeNull()
		expect(replaceState).toHaveBeenCalledTimes(1)
		view.rerender(<AppView {...props} runId="run-1" />)
		expect(replaceState).toHaveBeenCalledTimes(1)
		replaceState.mockRestore()
	})

	it("waits for a pending user navigation before leaving the finished run", async () => {
		window.history.replaceState(null, "", "/?runId=run-1")
		const view = render(<AppView {...props} runId="run-1" />)
		act(() => hudVisibilityStore.setState({ navigationPending: true }))
		mocks.shouldReturnHome = true
		view.rerender(<AppView {...props} runId="run-1" />)
		expect(window.location.search).toBe("?runId=run-1")
		act(() => hudVisibilityStore.setState({ navigationPending: false }))
		await waitFor(() => expect(window.location.pathname + window.location.search).toBe("/"))
	})

	it("releases pending navigation when a stale table row reopens the same finished run", async () => {
		window.history.replaceState(null, "", "/?runId=run-1")
		mocks.shouldReturnHome = true
		const view = render(<AppView {...props} runId="run-1" />)
		act(() => hudVisibilityStore.setState({ navigationPending: true }))
		window.history.replaceState(null, "", "/?runId=run-1")
		view.rerender(<AppView {...props} runId="run-1" initialRunView={{
			project: "alpha",
			status: "completed",
			current_agent_name: null,
			parent_agent_name: null,
			message_trace: [],
			current_prompt_id: null,
			current_prompt: null,
			error: null,
		}} />)
		await waitFor(() => expect(window.location.search).toBe(""))
		expect(hudVisibilityStore.getState().navigationPending).toBe(false)
	})

	it("does not replace a newer run URL when an older session finishes", () => {
		window.history.replaceState(null, "", "/?runId=run-2")
		mocks.shouldReturnHome = true
		render(<AppView {...props} runId="run-1" />)
		expect(window.location.search).toBe("?runId=run-2")
	})
})
