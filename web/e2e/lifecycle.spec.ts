import { expect, test, type Page } from "@playwright/test"
import fs from "node:fs/promises"
import {
	createProject,
	e2eProjectPaths,
	expectLibrarianSettledOnDisk,
	gotoLanding,
	holdLibrarian,
	holdLibrarianConsolidation,
	holdLibrarianCancellation,
	librarianIsRunningOnDisk,
	projectRow,
	releaseLibrarian,
	releaseLibrarianConsolidation,
	releaseLibrarianCancellation,
	trackCancelPosts,
	waitFor,
	waitForAnyRowStatus,
	waitForProjectRowStatus,
	walkFiles,
} from "./helpers"
import {
	PipeEventType,
	RunLifecycleKind,
	WireLifecycleStatus,
	WireRuntimeEventCategory,
	WireRuntimeEventKind,
	WireRunStatus,
} from "../lib/robosprawl/wire"

test.describe.configure({ mode: "serial" })
test.setTimeout(90_000)

const ORCHESTRATOR_AGENT_NAME = "orchestrator"
const PROMPT_USER_TOOL_NAME = "prompt_user"

/**
 * Opens a dormant project and drives the scripted mock orchestrator to
 * completion: prompt_user -> hello_world -> prompt_user -> stop (see
 * `_mock_orchestrator_responses` in src/robosprawl/mock/agents.py). Once "stop"
 * runs, the completed run route is replaced by the landing route.
 */
async function openAndCompleteRun(page: Page, slug: string): Promise<void> {
	await gotoLanding(page)
	await projectRow(page, slug).getByRole("button", { name: `Open ${slug}` }).click()
	await expect(page).toHaveURL(/[?&]runId=/, { timeout: 10_000 })
	const runId = new URL(page.url()).searchParams.get("runId")
	if (!runId) throw new Error("run page URL did not include runId")
	let runViewRequests = 0
	const countRunViewRequest = (request: { url: () => string }) => {
		if (
			new URL(request.url()).pathname ===
			`/api/runs/${encodeURIComponent(runId)}/view`
		) {
			runViewRequests += 1
		}
	}
	page.on("request", countRunViewRequest)
	await expect(page.locator(".agent-hud__textarea")).toBeVisible({ timeout: 15_000 })
	// The composer is intentionally always available, so wait for the backend's
	// first replyable prompt rather than treating textarea visibility as readiness.
	await expect(
		page.locator(".agent-hud__agent", {
			hasText: "Hello! I generated a text artifact for validation:",
		}),
	).toBeVisible({ timeout: 15_000 })

	await page.locator(".agent-hud__textarea").fill("first reply")
	const send = page.getByRole("button", { name: "Send", exact: true })
	await expect(send).toBeEnabled()
	await send.click()
	await expect(
		page.locator(".agent-hud__agent", {
			hasText: "Thanks. One more thing before I finish?",
		}),
	).toBeVisible({ timeout: 15_000 })

	await page.locator(".agent-hud__textarea").fill("second reply")
	await expect(send).toBeEnabled()
	await send.click()
	// "stop" drives the run to COMPLETED. The run URL is replaced, so the
	// session unmounts and its old fallback poller cannot outlive the run.
	await expect
		.poll(() => new URL(page.url()).searchParams.get("runId"), {
			timeout: 15_000,
		})
		.toBeNull()
	await expect(page.locator(".agent-hud__project-view")).toBeVisible({
		timeout: 15_000,
	})
	await expect(page.locator(".app-nav__brand")).toBeVisible()
	await expect(page.locator(".agent-hud__view-trigger")).toHaveText(
		"Runs Overview",
	)
	await expect(
		page.getByRole("slider", { name: "Resize HUD" }),
	).toHaveAttribute("aria-valuenow", "0")
	await expect(page.locator(".term-log")).not.toHaveClass(
		/term-log--scrollable/,
	)

	const requestsAfterLanding = runViewRequests
	await page.waitForTimeout(2_200)
	expect(runViewRequests).toBe(requestsAfterLanding)
	page.off("request", countRunViewRequest)
}

test("happy path: syncing blocks actions and only settles once the librarian's real files land", async ({
	page,
	request,
}) => {
	const slug = await createProject(request, `Lifecycle Sync E2E ${Date.now()}`)
	const paths = e2eProjectPaths(slug)
	await holdLibrarianConsolidation(slug)

	try {
		await openAndCompleteRun(page, slug)

		await gotoLanding(page)
		const row = await waitForProjectRowStatus(page, slug, "SYNCING")

		const openButton = row.getByRole("button", { name: `Open ${slug}` })
		const deleteButton = row.getByRole("button", { name: "Delete", exact: true })
		const cancelButton = row.getByRole("button", { name: "Cancel", exact: true })
		await expect(openButton).toBeDisabled()
		await expect(deleteButton).toBeDisabled()
		await expect(cancelButton).toBeEnabled()

		const createWhileSyncing = await request.post("/api/runs/create", {
			data: { project: slug },
		})
		expect(createWhileSyncing.status()).toBe(409)

		expect(await librarianIsRunningOnDisk(paths.logs)).toBe(true)
		const pendingSnapshotPath = await waitFor(
			"snapshot published before held final consolidation",
			async () => {
				const files = await walkFiles(paths.snapshots, ".md")
				return files[0] ?? null
			},
		)
		await expect.poll(() => fs.readFile(pendingSnapshotPath, "utf8"))
			.toContain("# Conversation Snapshot")
		expect(await walkFiles(paths.memory, ".md")).toHaveLength(0)

		await releaseLibrarianConsolidation(slug)

		const snapshotPath = await waitFor("librarian snapshot markdown", async () => {
			const files = await walkFiles(paths.snapshots, ".md")
			return files[0] ?? null
		})
		await expect.poll(() => fs.readFile(snapshotPath, "utf8"))
			.toContain("# Conversation Snapshot")
		await expect.poll(() => fs.readFile(snapshotPath, "utf8"))
			.toContain("Librarian generated this memory.")

		const memoryPath = await waitFor("librarian memory markdown", async () => {
			const files = await walkFiles(paths.memory, ".md")
			return files[0] ?? null
		})
		await expect.poll(() => fs.readFile(memoryPath, "utf8"))
			.toContain("Librarian generated this memory.")

		await expect(row.getByText("DORMANT", { exact: true })).toBeVisible({
			timeout: 20_000,
		})
		await expectLibrarianSettledOnDisk(paths.logs)
		await expect(openButton).toBeEnabled()
		await expect(deleteButton).toBeEnabled()
		await expect(cancelButton).toBeDisabled()
	} finally {
		await releaseLibrarianConsolidation(slug)
	}
})

test("a syncing project can be cancelled without waiting for the librarian to finish on its own", async ({
	page,
	request,
}) => {
	const slug = await createProject(request, `Lifecycle Cancel Sync E2E ${Date.now()}`)
	const paths = e2eProjectPaths(slug)
	await holdLibrarian(slug)

	try {
		await openAndCompleteRun(page, slug)

		await gotoLanding(page)
		const row = await waitForProjectRowStatus(page, slug, "SYNCING")
		const cancelPosts = trackCancelPosts(page, slug)

		await row.getByRole("button", { name: "Cancel", exact: true }).click()
		await expect.poll(() => cancelPosts()).toBeGreaterThanOrEqual(1)
		await waitForAnyRowStatus(row, ["CANCELLING", "DORMANT"])

		// The hold marker is deliberately left in place: reaching DORMANT here can
		// only happen if cancelling the project also cancelled the librarian's
		// background pipe (breaking it out of the hold), not because the test
		// released it.
		await expect(row.getByText("DORMANT", { exact: true })).toBeVisible({
			timeout: 20_000,
		})
		await expectLibrarianSettledOnDisk(paths.logs)
	} finally {
		await releaseLibrarian(slug)
	}
})

test("landing cancel follows real backend cancellation events without navigation abort noise", async ({
	page,
	request,
}) => {
	type ReplayEntry = {
		type: string
		payload: Record<string, unknown>
	}
	type RunReplay = {
		status: string
		message_trace: ReplayEntry[]
	}

	const slug = await createProject(request, `Cancellation Events E2E ${Date.now()}`)
	const paths = e2eProjectPaths(slug)
	const browserWarnings: string[] = []
	page.on("console", (message) => {
		if (message.type() === "warning") browserWarnings.push(message.text())
	})
	await holdLibrarian(slug)
	await holdLibrarianCancellation(slug)

	try {
		await gotoLanding(page)
		await projectRow(page, slug)
			.getByRole("button", { name: `Open ${slug}` })
			.click()
		await expect(page).toHaveURL(/[?&]runId=/, { timeout: 10_000 })
		const runId = new URL(page.url()).searchParams.get("runId")
		if (!runId) throw new Error("run page URL did not include runId")
		await expect(page.locator(".agent-hud__textarea")).toBeVisible({
			timeout: 15_000,
		})
		await waitFor("running librarian before cancellation", async () =>
			(await librarianIsRunningOnDisk(paths.logs)) ? true : null,
		)

		// Leaving a live run disposes the real fetch/SSE reader. This must be quiet.
		await gotoLanding(page)
		const row = await waitForProjectRowStatus(page, slug, "WAITING")
		await page.evaluate((targetSlug: string) => {
			const observedWindow = window as typeof window & {
				__cancelStatusHistory?: string[]
				__cancelStatusObserver?: MutationObserver
			}
			const labels = [
				"RUNNING",
				"WAITING",
				"CANCELLING",
				"SYNCING",
				"DORMANT",
			]
			const history: string[] = []
			const record = () => {
				const openButton = [...document.querySelectorAll("button")].find(
					(button) =>
						button.getAttribute("aria-label") === `Open ${targetSlug}`,
				)
				const text = openButton?.closest("li")?.textContent ?? ""
				const status = labels.find((label) => text.includes(label))
				if (status && history.at(-1) !== status) history.push(status)
			}
			observedWindow.__cancelStatusHistory = history
			observedWindow.__cancelStatusObserver = new MutationObserver(record)
			observedWindow.__cancelStatusObserver.observe(document.documentElement, {
				childList: true,
				characterData: true,
				subtree: true,
			})
			record()
		}, slug)

		const cancelResponsePromise = page.waitForResponse(
			(response) =>
				response.request().method() === "POST" &&
				response
					.url()
					.includes(`/api/projects/${encodeURIComponent(slug)}/cancel`),
		)
		await row.getByRole("button", { name: "Cancel", exact: true }).click()
		const cancelResponse = await cancelResponsePromise
		expect(cancelResponse.ok()).toBe(true)
		await expect(row.getByText("CANCELLING", { exact: true })).toBeVisible()

		const replay = await waitFor<RunReplay>(
			"cancelled root lifecycle replay",
			async () => {
				const response = await request.get(`/api/runs/${runId}/view`)
				if (!response.ok()) return null
				const view = (await response.json()) as RunReplay
				const rootStopped = view.message_trace.some(
					(entry) =>
						entry.type === PipeEventType.RunLifecycle &&
						entry.payload.kind === RunLifecycleKind.Stopped &&
						entry.payload.agent_name === ORCHESTRATOR_AGENT_NAME &&
						entry.payload.status === WireLifecycleStatus.Cancelled,
				)
				return view.status === WireRunStatus.Cancelled && rootStopped ? view : null
			},
		)
		expect(
			replay.message_trace.some((entry) => {
				if (
					entry.type !== PipeEventType.RuntimeEvent ||
					entry.payload.category !== WireRuntimeEventCategory.Tool ||
					entry.payload.kind !== WireRuntimeEventKind.Cancelled
				)
					return false
				const data = entry.payload.data as Record<string, unknown> | undefined
				return (
					entry.payload.agent_name === ORCHESTRATOR_AGENT_NAME &&
					data?.tool === PROMPT_USER_TOOL_NAME
				)
			}),
		).toBe(true)

		// The root has stopped, but the held librarian keeps the project non-dormant.
		expect(await librarianIsRunningOnDisk(paths.logs)).toBe(true)
		await page.waitForTimeout(400)
		await expect(row.getByText("CANCELLING", { exact: true })).toBeVisible()
		await expect(row.getByText("SYNCING", { exact: true })).toHaveCount(0)
		await expect(row.getByText("DORMANT", { exact: true })).toHaveCount(0)

		await releaseLibrarianCancellation(slug)
		await waitFor(
			"persisted librarian active marker removal",
			async () => ((await librarianIsRunningOnDisk(paths.logs)) ? null : true),
			10_000,
			50,
		)
		await expect(row.getByText("DORMANT", { exact: true })).toBeVisible()

		const statusHistory = await page.evaluate(() => {
			const observedWindow = window as typeof window & {
				__cancelStatusHistory?: string[]
			}
			return observedWindow.__cancelStatusHistory ?? []
		})
		const cancellingIndex = statusHistory.indexOf("CANCELLING")
		expect(cancellingIndex).toBeGreaterThanOrEqual(0)
		expect(statusHistory.slice(cancellingIndex)).toEqual([
			"CANCELLING",
			"DORMANT",
		])
		expect(
			browserWarnings.some(
				(message) =>
					message.includes("[robosprawl:sse] reader error") &&
					message.includes("AbortError"),
			),
		).toBe(false)
	} finally {
		await releaseLibrarianCancellation(slug)
		await releaseLibrarian(slug)
	}
})

test("refresh never flashes dormant while project cancellation is still unwinding", async ({
	page,
	request,
}) => {
	const slug = await createProject(request, `Cancellation Refresh E2E ${Date.now()}`)
	const paths = e2eProjectPaths(slug)
	await holdLibrarian(slug)
	await holdLibrarianCancellation(slug)

	try {
		await gotoLanding(page)
		await projectRow(page, slug)
			.getByRole("button", { name: `Open ${slug}` })
			.click()
		await expect(page).toHaveURL(/[?&]runId=/, { timeout: 10_000 })
		await expect(page.locator(".agent-hud__textarea")).toBeVisible({
			timeout: 15_000,
		})
		await waitFor("running librarian before cancellation", async () =>
			(await librarianIsRunningOnDisk(paths.logs)) ? true : null,
		)

		await gotoLanding(page)
		const row = await waitForProjectRowStatus(page, slug, "WAITING")
		await row.getByRole("button", { name: "Cancel", exact: true }).click()
		await expect(row.getByText("CANCELLING", { exact: true })).toBeVisible({
			timeout: 15_000,
		})

		await page.addInitScript((targetSlug: string) => {
			const observedWindow = window as typeof window & {
				__projectStatusHistory?: string[]
			}
			const history: string[] = []
			observedWindow.__projectStatusHistory = history
			const labels = [
				"RUNNING",
				"WAITING",
				"OPENING",
				"CANCELLING",
				"SYNCING",
				"DELETING",
				"DORMANT",
			]
			const record = () => {
				const openButton = [...document.querySelectorAll("button")].find(
					(button) => button.getAttribute("aria-label") === `Open ${targetSlug}`,
				)
				const text = openButton?.closest("li")?.textContent ?? ""
				const status = labels.find((label) => text.includes(label))
				if (status && history.at(-1) !== status) history.push(status)
			}
			const startObserving = () => {
				if (!document.documentElement) {
					window.setTimeout(startObserving, 0)
					return
				}
				const observer = new MutationObserver(record)
				observer.observe(document.documentElement, {
					childList: true,
					characterData: true,
					subtree: true,
				})
				record()
			}
			startObserving()
		}, slug)

		await page.reload()
		const refreshedRow = await waitForProjectRowStatus(page, slug, "CANCELLING")
		await expect(
			refreshedRow.getByRole("button", { name: `Open ${slug}` }),
		).toBeDisabled()

		const history = await page.evaluate(() => {
			const observedWindow = window as typeof window & {
				__projectStatusHistory?: string[]
			}
			return observedWindow.__projectStatusHistory ?? []
		})
		expect(history[0]).toBe("CANCELLING")
		expect(history).not.toContain("DORMANT")
		expect(history).not.toContain("SYNCING")

		const createWhileCancelling = await request.post("/api/runs/create", {
			data: { project: slug },
		})
		expect(createWhileCancelling.status()).toBe(409)

		await releaseLibrarianCancellation(slug)
		await expect(refreshedRow.getByText("DORMANT", { exact: true })).toBeVisible({
			timeout: 20_000,
		})
	} finally {
		await releaseLibrarianCancellation(slug)
		await releaseLibrarian(slug)
	}
})
