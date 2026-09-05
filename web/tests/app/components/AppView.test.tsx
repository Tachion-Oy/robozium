import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"

const mocks = vi.hoisted(() => ({
	routerReplace: vi.fn(),
	shouldReturnHome: false,
}))

vi.mock("next/navigation", () => ({
	useRouter: () => ({ replace: mocks.routerReplace }),
}))

vi.mock("../../../hooks/useRunNotifications", () => ({
	useRunNotifications: () => {},
}))

vi.mock("../../../hooks/useRunSession", () => ({
	RunSessionProvider: ({ children }: { children: ReactNode }) => children,
	useRunSessionSelector: () => mocks.shouldReturnHome,
}))

vi.mock(
	"../../../app/components/terminal/TerminalFrame",
	() => ({
		TerminalFrame: ({ children }: { children: ReactNode }) => children,
	}),
)

vi.mock(
	"../../../app/components/terminal/TerminalRunView",
	() => ({
		TerminalRunView: ({ playIntro }: { playIntro: boolean }) => (
			<div>{playIntro ? "intro" : "placeholder"}</div>
		),
	}),
)

vi.mock("../../../app/components/hud/AgentHUD", () => ({
	AgentHUD: () => null,
}))

import { AppView } from "../../../app/components/AppView"

beforeEach(() => {
	vi.clearAllMocks()
	mocks.shouldReturnHome = false
})

afterEach(() => {
	cleanup()
})

describe("AppView landing intro", () => {
	it("does not replay after leaving and returning in the same client runtime", async () => {
		const first = render(
			<AppView
				runId={null}
				error={null}
				from={null}
				modelSelectionPromise={Promise.resolve(null)}
			/>,
		)
		expect(screen.getByText("intro")).not.toBeNull()

		first.unmount()

		render(
			<AppView
				runId={null}
				error={null}
				from={null}
				modelSelectionPromise={Promise.resolve(null)}
			/>,
		)
		expect(screen.getByText("placeholder")).not.toBeNull()
		expect(screen.queryByText("intro")).toBeNull()
	})
})

describe("AppView run completion navigation", () => {
	it("keeps an active run on its current route", () => {
		render(
			<AppView
				runId="run-1"
				error={null}
				from={null}
				modelSelectionPromise={Promise.resolve(null)}
			/>,
		)

		expect(mocks.routerReplace).not.toHaveBeenCalled()
	})

	it("replaces a terminal or unavailable run with the no-intro home route once", async () => {
		mocks.shouldReturnHome = true
		const view = render(
			<AppView
				runId="run-1"
				error={null}
				from={null}
				modelSelectionPromise={Promise.resolve(null)}
			/>,
		)

		await waitFor(() =>
			expect(mocks.routerReplace).toHaveBeenCalledWith("/?from=app", {
				scroll: false,
			}),
		)

		view.rerender(
			<AppView
				runId="run-1"
				error={null}
				from={null}
				modelSelectionPromise={Promise.resolve(null)}
			/>,
		)
		expect(mocks.routerReplace).toHaveBeenCalledTimes(1)
	})

	it("does not redirect a landing route", () => {
		mocks.shouldReturnHome = true
		render(
			<AppView
				runId={null}
				error={null}
				from="app"
				modelSelectionPromise={Promise.resolve(null)}
			/>,
		)

		expect(mocks.routerReplace).not.toHaveBeenCalled()
	})
})
