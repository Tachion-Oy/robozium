import type { ReactNode } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	linkProps: null as Record<string, unknown> | null,
	pending: false,
	searchParams: "",
}))

vi.mock("next/link", () => ({
	default: ({
		children,
		...props
	}: {
		children: ReactNode
		[key: string]: unknown
	}) => {
		mocks.linkProps = props
		return <span>{children}</span>
	},
	useLinkStatus: () => ({ pending: mocks.pending }),
}))
vi.mock("next/navigation", () => ({
	useSearchParams: () => new URLSearchParams(mocks.searchParams),
}))

vi.mock("../../../../lib/robosprawl/public-config", () => ({
	HUB_BRAND: "ROBOSPRAWL",
	HUB_HOME_ARIA_LABEL: "robosprawl home",
}))

import { AppNav } from "../../../../app/components/nav/AppNav"

afterEach(() => {
	cleanup()
	mocks.linkProps = null
	mocks.pending = false
	mocks.searchParams = ""
})

describe("AppNav", () => {
	it("fully prefetches the dynamic landing route", () => {
		render(<AppNav />)

		expect(mocks.linkProps?.href).toEqual({
			pathname: "/",
			query: { from: "app" },
		})
		expect(mocks.linkProps?.prefetch).toBe(true)
		expect(mocks.linkProps?.className).toContain("app-nav__brand--bar")
	})

	it("marks only a pending title navigation", () => {
		const idle = render(<AppNav />)
		expect(screen.getByText("ROBOSPRAWL").hasAttribute("data-pending")).toBe(false)

		idle.unmount()
		mocks.pending = true
		render(<AppNav />)

		expect(screen.getByText("ROBOSPRAWL").getAttribute("data-pending")).toBe("true")
	})

	it("does not render home navigation in a run view", () => {
		mocks.searchParams = "runId=run-1"
		render(<AppNav />)

		expect(screen.queryByText("ROBOSPRAWL")).toBeNull()
		expect(mocks.linkProps).toBeNull()
	})
})
