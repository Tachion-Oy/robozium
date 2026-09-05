import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DependencyRecord } from "../../../../../lib/robosprawl/wire"

const mocks = vi.hoisted(() => ({
	checkDependencies: vi.fn(),
	listDependencies: vi.fn(),
	showErrorToast: vi.fn(),
}))

vi.mock("../../../../../lib/robosprawl/client", () => ({
	checkDependencies: mocks.checkDependencies,
	listDependencies: mocks.listDependencies,
}))
vi.mock("../../../../../app/components/feedback/ErrorToast", () => ({
	showErrorToast: mocks.showErrorToast,
}))

import { DependencyPanel } from "../../../../../app/components/hud/dependencies/DependencyPanel"

function record(
	overrides: Partial<DependencyRecord> = {},
): DependencyRecord {
	return {
		dependency_id: "executable:bash",
		kind: "executable",
		redacted_metadata: { executable: "bash" },
		status: "available",
		checked_at: "2026-07-23T08:00:00Z",
		latency_ms: 1.25,
		reason_code: null,
		...overrides,
	}
}

async function renderPanel(records: DependencyRecord[] = []) {
	mocks.listDependencies.mockResolvedValueOnce(records)
	render(<DependencyPanel />)
	await waitFor(() => {
		expect(screen.queryByText("Loading dependency records…")).toBeNull()
	})
}

function renderedDependencyIds(): string[] {
	return screen
		.getAllByRole("row")
		.slice(1)
		.map((row) => row.querySelector("code")?.textContent ?? "")
}

beforeEach(() => {
	vi.clearAllMocks()
})

afterEach(() => cleanup())

describe("DependencyPanel", () => {
	it("loads and renders the existing dependency monitor inside HUD content", async () => {
		await renderPanel([
			record(),
			record({
				dependency_id: "network:mail",
				kind: "network_service",
				redacted_metadata: {
					provider: "mail-bridge",
					host: "bridge.internal",
				},
				status: "unavailable",
				checked_at: "2026-07-23T08:01:02.345Z",
				latency_ms: 20,
				reason_code: "connection_failed",
			}),
			record({
				dependency_id: "model:provider:model",
				kind: "model_endpoint",
				redacted_metadata: {},
				status: "pending",
				checked_at: null,
				latency_ms: null,
			}),
		])

		expect(mocks.listDependencies).toHaveBeenCalledWith({
			signal: expect.any(AbortSignal),
		})
		expect(screen.queryByText("System Administration")).toBeNull()
		expect(screen.queryByRole("heading")).toBeNull()
		expect(screen.getByText("1").closest("p")?.textContent).toMatch(
			/1\s*\/\s*3 available/i,
		)
		expect(screen.getByText("AVAILABLE")).not.toBeNull()
		expect(screen.getByText("UNAVAILABLE")).not.toBeNull()
		expect(screen.getByText("PENDING")).not.toBeNull()
		expect(screen.getByText("provider=")).not.toBeNull()
		expect(screen.getByText("mail-bridge")).not.toBeNull()
		expect(
			screen.getByRole("columnheader", { name: "Checked (GMT+3)" }),
		).not.toBeNull()
		expect(screen.getAllByText("2026-07-23").length).toBeGreaterThan(0)
		expect(screen.getByText("11:01:02")).not.toBeNull()
		expect(screen.queryByText(/Z$/)).toBeNull()
		expect(screen.queryByRole("columnheader", { name: "Latency" })).toBeNull()
		expect(screen.getByRole("table").className).not.toContain("min-w-")
		expect(screen.getByText("connection_failed")).not.toBeNull()
		expect(screen.getByText("Not checked")).not.toBeNull()
	})

	it("renders the empty state", async () => {
		await renderPanel()

		expect(screen.getByText("0").closest("p")?.textContent).toMatch(
			/0\s*\/\s*0 available/i,
		)
		expect(screen.getByText("No dependencies registered")).not.toBeNull()
	})

	it("sorts by Status or Dependency ID", async () => {
		await renderPanel([
			record({ dependency_id: "model:zeta", status: "pending" }),
			record({ dependency_id: "executable:zeta" }),
			record({ dependency_id: "network:alpha", status: "unavailable" }),
			record({ dependency_id: "executable:alpha" }),
		])

		const statusButton = screen.getByRole("button", { name: "Status" })
		const idButton = screen.getByRole("button", { name: "Dependency ID" })
		expect(renderedDependencyIds()).toEqual([
			"executable:alpha",
			"executable:zeta",
			"model:zeta",
			"network:alpha",
		])

		fireEvent.click(statusButton)
		expect(statusButton.closest("th")?.getAttribute("aria-sort")).toBe(
			"descending",
		)
		expect(renderedDependencyIds()[0]).toBe("network:alpha")

		fireEvent.click(idButton)
		expect(idButton.closest("th")?.getAttribute("aria-sort")).toBe(
			"ascending",
		)
		expect(statusButton.closest("th")?.getAttribute("aria-sort")).toBe("none")
	})

	it("shows a load failure and lets Check Now replace it with records", async () => {
		mocks.listDependencies.mockRejectedValueOnce(new Error("offline"))
		mocks.checkDependencies.mockResolvedValueOnce([
			record({ dependency_id: "executable:recovered" }),
		])
		render(<DependencyPanel />)

		await waitFor(() => {
			expect(screen.getByRole("alert").textContent).toContain(
				"Unable to load dependency records",
			)
		})
		fireEvent.click(screen.getByRole("button", { name: "Check Now" }))

		await waitFor(() => {
			expect(screen.getByText("executable:recovered")).not.toBeNull()
		})
		expect(screen.queryByRole("alert")).toBeNull()
	})

	it("preserves current rows and reports a failed explicit check", async () => {
		await renderPanel([record({ dependency_id: "executable:kept" })])
		mocks.checkDependencies.mockRejectedValueOnce(new Error("hub offline"))

		fireEvent.click(screen.getByRole("button", { name: "Check Now" }))

		await waitFor(() => {
			expect(mocks.showErrorToast).toHaveBeenCalledWith({
				title: "Dependency Check Failed",
				message: "Unable to check dependencies.",
				detail: "hub offline",
			})
		})
		const table = screen.getByRole("table")
		expect(within(table).getByText("executable:kept")).not.toBeNull()
	})
})
