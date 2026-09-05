import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test"
import fs from "node:fs/promises"
import path from "node:path"

export async function gotoLanding(page: Page): Promise<void> {
	// `from=app` bypasses first-load intro while preserving normal landing behavior.
	await page.goto("/?from=app")
	await page.waitForLoadState("networkidle")
	await expect(
		page.getByRole("button", { name: "New Project", exact: true }),
	).toBeVisible({ timeout: 15_000 })
}

export async function selectHudView(page: Page, name: string): Promise<void> {
	await page.locator(".agent-hud__view-trigger").click()
	await page.getByRole("option", { name, exact: true }).click()
}

export function projectRow(page: Page, slug: string) {
	return page.locator("ul > li", {
		has: page.getByRole("button", { name: `Open ${slug}`, exact: true }),
	})
}

export async function waitForProjectRowStatus(
	page: Page,
	slug: string,
	status:
		| "RUNNING"
		| "WAITING"
		| "OPENING"
		| "SYNCING"
		| "CANCELLING"
		| "DORMANT",
) {
	const row = projectRow(page, slug)
	await expect(row).toBeVisible({ timeout: 20_000 })
	await expect(row.getByText(status, { exact: true })).toBeVisible({
		timeout: 20_000,
	})
	return row
}

export async function waitForAnyRowStatus(
	row: Locator,
	statuses: readonly string[],
	timeoutMs = 20_000,
): Promise<string> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		for (const status of statuses) {
			if ((await row.getByText(status, { exact: true }).count()) > 0) {
				return status
			}
		}
		await row.page().waitForTimeout(200)
	}
	throw new Error(`Timed out waiting for one of statuses: ${statuses.join(", ")}`)
}

export async function walkFiles(root: string, extension: string): Promise<string[]> {
	const files: string[] = []
	const stack = [root]
	while (stack.length > 0) {
		const current = stack.pop()
		if (!current) continue
		let entries
		try {
			entries = await fs.readdir(current, { withFileTypes: true })
		} catch {
			continue
		}
		for (const entry of entries) {
			const fullPath = path.join(current, entry.name)
			if (entry.isDirectory()) {
				stack.push(fullPath)
				continue
			}
			if (entry.isFile() && fullPath.endsWith(extension)) {
				files.push(fullPath)
			}
		}
	}
	return files
}

export async function waitFor<T>(
	description: string,
	probe: () => Promise<T | null>,
	timeoutMs = 30_000,
	intervalMs = 200,
): Promise<T> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		const value = await probe()
		if (value !== null) return value
		await new Promise((resolve) => setTimeout(resolve, intervalMs))
	}
	throw new Error(`Timed out waiting for ${description}`)
}

/** Folders the mock backend derives from `hub.config.json` (see run-mock-playwright.sh). */
export function e2eProjectPaths(slug: string) {
	const hubBaseDir = process.env.ROBOSPRAWL_E2E_HUB_BASE_DIR
	if (!hubBaseDir) {
		throw new Error("ROBOSPRAWL_E2E_HUB_BASE_DIR is not set")
	}
	const root = path.join(hubBaseDir, "projects", slug)
	return {
		root,
		logs: path.join(root, "conversation_logs"),
		snapshots: path.join(root, "conversation_snapshots"),
		memory: path.join(root, "persistent_memory"),
	}
}

const LIBRARIAN_HOLD_MARKER = ".librarian-hold"
const LIBRARIAN_CANCEL_HOLD_MARKER = ".librarian-cancel-hold"
const LIBRARIAN_AGENT_NAME = "librarian"

/** Blocks the mock librarian's LLM endpoint so the project stays SYNCING. */
export async function holdLibrarian(slug: string): Promise<void> {
	const { root } = e2eProjectPaths(slug)
	await fs.mkdir(root, { recursive: true })
	await fs.writeFile(path.join(root, LIBRARIAN_HOLD_MARKER), "", "utf8")
}

export async function releaseLibrarian(slug: string): Promise<void> {
	const { root } = e2eProjectPaths(slug)
	await fs.rm(path.join(root, LIBRARIAN_HOLD_MARKER), { force: true })
}

export async function holdLibrarianCancellation(slug: string): Promise<void> {
	const { root } = e2eProjectPaths(slug)
	await fs.mkdir(root, { recursive: true })
	await fs.writeFile(path.join(root, LIBRARIAN_CANCEL_HOLD_MARKER), "", "utf8")
}

export async function releaseLibrarianCancellation(slug: string): Promise<void> {
	const { root } = e2eProjectPaths(slug)
	await fs.rm(path.join(root, LIBRARIAN_CANCEL_HOLD_MARKER), { force: true })
}

async function agentIsRunningOnDisk(
	logsDir: string,
	agentName: string,
): Promise<boolean> {
	try {
		return (await fs.readdir(path.join(logsDir, agentName, ".lifecycle", "active"))).some(
			(name) => name.endsWith(".run"),
		)
	} catch {
		// A missing lifecycle directory means this agent has never run.
		return false
	}
}

export async function librarianIsRunningOnDisk(logsDir: string): Promise<boolean> {
	// This is the same persisted signal from which the backend derives SYNCING.
	return agentIsRunningOnDisk(logsDir, LIBRARIAN_AGENT_NAME)
}

/** The "no false DORMANT" invariant: once the UI settles, the librarian must have actually stopped. */
export async function expectLibrarianSettledOnDisk(logsDir: string): Promise<void> {
	expect(await librarianIsRunningOnDisk(logsDir)).toBe(false)
}

export async function createProject(
	request: APIRequestContext,
	name: string,
): Promise<string> {
	const response = await request.post("/api/projects", { data: { name } })
	expect(response.ok()).toBeTruthy()
	const { slug } = (await response.json()) as { slug: string }
	return slug
}

export function trackCancelPosts(page: Page, slug: string): () => number {
	let count = 0
	page.on("request", (outgoing) => {
		if (
			outgoing.method() === "POST" &&
			outgoing.url().includes(`/api/projects/${encodeURIComponent(slug)}/cancel`)
		) {
			count += 1
		}
	})
	return () => count
}
