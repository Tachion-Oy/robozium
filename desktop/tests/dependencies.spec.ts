import { expect, type ElectronApplication, type Page } from "@playwright/test"
import { writeFile } from "node:fs/promises"
import { test, json, view } from "./run-fixture"
import { captureNative, setNativeViewport, startupDone, toast } from "./native"
import type { Backend } from "./selection-fixture"

type Dependency = {
	dependency_id: string; kind: string; redacted_metadata: Record<string, string>; status: "pending" | "available" | "unavailable"
	checked_at: string | null; latency_ms: number | null; reason_code: string | null; message: string | null
}
const dependency = (id: string, overrides: Partial<Dependency> = {}): Dependency => ({
	dependency_id: id, kind: "executable", redacted_metadata: { executable: id.split(":").at(-1) ?? id }, status: "available",
	checked_at: "2026-10-11T19:17:27Z", latency_ms: 1, reason_code: null, message: null, ...overrides,
})
const failure = dependency("network:diagnostic-test", {
	kind: "network_service", redacted_metadata: { host: "bridge.invalid" }, status: "unavailable", reason_code: "connection_failed",
	message: "Unable to communicate with Bridge\nCaused by: gaierror: [Errno -2] Name or service not known",
})
const panel = (page: Page) => page.locator(".agent-hud__status-view")
const checkNow = (page: Page) => panel(page).getByRole("button", { name: "Check Now", exact: true })
// The backend controls sit in Environment's action row.
const backendButton = (page: Page, name: string) =>
	page.getByRole("region", { name: "Environment settings" }).getByLabel("Backend controls").getByRole("button", { name })
async function openEnvironment(page: Page, backend: Backend) {
	await backend.open()
	await view(page, "Environment")
	await expect(backendButton(page, "Restart backend")).toBeVisible()
}
const checks = (backend: Backend) => backend.requests.filter(request => request.method === "POST" && request.path === "/admin/dependencies/check")

async function openDependencies(page: Page, backend: Backend, records: Dependency[] | (() => Dependency[])) {
	backend.handlers.set("GET /admin/dependencies", response => json(response, typeof records === "function" ? records() : records))
	await backend.open()
	await view(page, "Dependencies")
	await expect(panel(page)).toBeVisible()
}

test("a failed load says so, and Check Now loads the records with their availability count", async ({ desktop: { page }, backend }) => {
	backend.handlers.set("GET /admin/dependencies", response => json(response, { detail: "Monitor unavailable" }, 503))
	await backend.open()
	await view(page, "Dependencies")
	// The failure is a toast with Check now; nothing appears inside the panel.
	await expect(toast(page, "Could not load dependencies")).toContainText("Unable to load dependency records.")
	await expect(panel(page).getByRole("alert")).toHaveCount(0)
	backend.handlers.set("POST /admin/dependencies/check", response => json(response, [dependency("executable:git"), failure]))
	await toast(page, "Could not load dependencies").getByRole("button", { name: "Check now" }).click()
	await expect(toast(page, "Could not load dependencies")).toHaveCount(0)
	await expect(panel(page).locator("p[aria-live]")).toHaveText("1 / 2 available")
	await expect(panel(page).getByRole("cell", { name: "UNAVAILABLE", exact: true })).toBeVisible()
	expect(checks(backend)).toHaveLength(1)
})

test("an empty monitor says no dependencies are registered", async ({ desktop: { page }, backend }) => {
	await openDependencies(page, backend, [])
	await expect(panel(page)).toContainText("No dependencies registered")
	await expect(panel(page).locator("p[aria-live]")).toHaveText("0 / 0 available")
})

test("status and dependency ID sort in both directions", async ({ desktop: { page }, backend }) => {
	await openDependencies(page, backend, [
		dependency("executable:zip"), dependency("executable:awk", { status: "pending", checked_at: null }), failure,
	])
	const ids = () => panel(page).locator("tbody tr td:nth-child(2) code").allTextContents()
	const header = (name: string) => panel(page).getByRole("columnheader", { name: new RegExp(`^${name}`) })
	await expect(header("Status")).toHaveAttribute("aria-sort", "ascending")
	expect(await ids()).toEqual(["executable:zip", "executable:awk", "network:diagnostic-test"])
	await header("Status").getByRole("button").click()
	await expect(header("Status")).toHaveAttribute("aria-sort", "descending")
	expect(await ids()).toEqual(["network:diagnostic-test", "executable:awk", "executable:zip"])
	await header("Dependency ID").getByRole("button").click()
	await expect(header("Dependency ID")).toHaveAttribute("aria-sort", "ascending")
	await expect(header("Status")).toHaveAttribute("aria-sort", "none")
	expect(await ids()).toEqual(["executable:awk", "executable:zip", "network:diagnostic-test"])
	await expect(panel(page).getByRole("cell", { name: "Not checked" })).toBeVisible()
})

test("a cause is copied through the native clipboard and clears once the check recovers", async ({ desktop: { app, page }, backend }) => {
	await openDependencies(page, backend, [failure])
	await expect(panel(page).getByText(/Caused by: gaierror/)).toBeVisible()
	await panel(page).getByRole("button", { name: "Copy diagnostic", exact: true }).click()
	await expect(panel(page).getByRole("button", { name: "Copied", exact: true })).toBeVisible()
	expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toContain(failure.message)

	backend.handlers.set("POST /admin/dependencies/check", response => json(response, { detail: "Probe crashed" }, 500))
	await checkNow(page).click()
	await expect(page.getByRole("alert").filter({ hasText: "Dependency Check Failed" })).toContainText("Probe crashed")
	await expect(panel(page).getByText(/Caused by: gaierror/)).toBeVisible()

	let release: () => void = () => {}
	backend.handlers.set("POST /admin/dependencies/check", response => {
		release = () => json(response, [{ ...failure, status: "available", reason_code: null, message: null }])
	})
	await checkNow(page).click()
	await expect(panel(page).getByRole("button", { name: "Checking…", exact: true })).toBeDisabled()
	await expect.poll(() => checks(backend).length).toBe(2)
	release()
	await expect(panel(page).getByRole("cell", { name: "AVAILABLE", exact: true })).toBeVisible()
	await expect(panel(page).getByText(/Caused by: gaierror/)).toHaveCount(0)
	expect(checks(backend)).toHaveLength(2)
})

/** Restart and Recreate wait in main until the test finishes them. */
async function holdBackendOperations(app: ElectronApplication) {
	await app.evaluate(({ ipcMain }) => {
		const calls: string[] = []
		Reflect.set(globalThis, "backendCalls", calls)
		for (const operation of ["restart", "recreate"]) {
			ipcMain.removeHandler(`desktop:${operation}-backend`)
			ipcMain.handle(`desktop:${operation}-backend`, () => new Promise<void>((resolve, reject) => {
				calls.push(operation)
				Reflect.set(globalThis, "finishBackend", (error?: string) => error ? reject(new Error(error)) : resolve())
			}))
		}
	})
	return {
		calls: () => app.evaluate(() => [...(Reflect.get(globalThis, "backendCalls") as string[])]),
		finish: (error?: string) => app.evaluate((_electron, error) => (Reflect.get(globalThis, "finishBackend") as (error?: string) => void)(error), error),
	}
}

test("Restart and Recreate run one backend operation at a time, report failures and reconnect", async ({ desktop: { app, page }, backend }) => {
	const { calls, finish } = await holdBackendOperations(app)
	const readiness = () => backend.requests.filter(request => request.path === "/ready").length
	await openEnvironment(page, backend)
	const restart = backendButton(page, "Restart backend")
	const recreate = backendButton(page, "Recreate backend")

	await restart.click()
	await expect.poll(calls).toEqual(["restart"])
	// The loading screen covers the HUD while the backend restarts.
	await expect(page.locator(".startup[data-stage='loading']")).toBeVisible()
	await expect(restart).toBeDisabled()
	await expect(recreate).toBeDisabled()
	// The covered HUD is inert: keyboard focus never reaches its controls.
	await expect(page.locator(".backend-startup__app")).toHaveAttribute("inert", "")
	for (let step = 0; step < 6; step++) {
		await page.keyboard.press("Tab")
		expect(await page.evaluate(() => Boolean(document.activeElement?.closest(".backend-startup__app")))).toBe(false)
	}
	const before = readiness()
	await finish()
	await startupDone(page)
	await expect(recreate).toBeEnabled()
	await expect.poll(readiness).toBeGreaterThan(before)

	await recreate.click()
	await expect.poll(calls).toEqual(["restart", "recreate"])
	await expect(page.locator(".startup")).toBeVisible()
	await finish("A backend operation is already running.")
	// A failure removes the loading screen again and explains itself.
	await startupDone(page)
	await expect(page.getByRole("alert").filter({ hasText: "Backend operation failed" })).toContainText("A backend operation is already running.")
	await expect(restart).toBeEnabled()
})

test("a slow restart keeps the loading screen, not the expected outage, even when readiness fails", async ({ desktop: { app, page }, backend }) => {
	const { calls, finish } = await holdBackendOperations(app)
	await openEnvironment(page, backend)
	const before = backend.requests.filter(request => request.path === "/ready").length
	backend.handlers.set("GET /ready", response => json(response, { detail: "Restarting" }, 503))
	await backendButton(page, "Restart backend").click()
	await expect.poll(calls).toEqual(["restart"])
	// The five-second poll fails while the operation runs.
	await expect.poll(() => backend.requests.filter(request => request.path === "/ready").length, { timeout: 10_000 }).toBeGreaterThan(before)
	// The outage is expected while the restart runs: no failure toast over the loader.
	await expect(page.locator(".startup .agent-hud__mini-box")).toBeVisible()
	await expect(toast(page, "Backend unavailable")).toHaveCount(0)
	backend.handlers.set("GET /ready", response => json(response, { status: "ready" }))
	await finish()
	await startupDone(page)
})

test("a reconnect that fails after a restart shows the error and Retry in a toast over the loading screen", async ({ desktop: { app, page }, backend }) => {
	const { calls, finish } = await holdBackendOperations(app)
	await openEnvironment(page, backend)
	await backendButton(page, "Restart backend").click()
	await expect.poll(calls).toEqual(["restart"])
	backend.handlers.set("GET /ready", response => json(response, { detail: "Restarting" }, 503))
	await finish()
	const failure = toast(page, "Backend unavailable")
	await expect(failure).toContainText("Backend connection unavailable. Check the backend and retry.")
	await expect(page.locator(".startup .agent-hud__mini-box")).toBeVisible()
	backend.handlers.set("GET /ready", response => json(response, { status: "ready" }))
	await failure.getByRole("button", { name: "Retry", exact: true }).click()
	await startupDone(page)
	await expect(page.locator(".backend-startup__app")).not.toHaveAttribute("inert")
	await expect(backendButton(page, "Restart backend")).toBeVisible()
})

for (const theme of ["dark", "light"]) {
	test(`long identifiers and diagnostics stay inside their cells in ${theme}`, async ({ desktop: { app, page }, backend }, testInfo) => {
		await openDependencies(page, backend, [dependency("executable:libreoffice", { redacted_metadata: { display_name: "libreoffice", executable: "libreoffice" } }), {
			...failure, dependency_id: `network:${"long-service-identifier".repeat(8)}`,
			redacted_metadata: { [`configuration_${"location".repeat(8)}`]: `/applications/${"directory".repeat(20)}` },
			message: `Unable to reach https://example.invalid/${"endpoint".repeat(40)}\nCheck the configured service address.`,
		}])
		if (theme === "light") await page.getByRole("button", { name: "Toggle color theme" }).click()
		for (const [width, height, zoom] of [[1260, 780, 1], [640, 420, 1.25]]) {
			await setNativeViewport(app, page, width, height, zoom)
			const geometry = await panel(page).locator(".agent-hud__table-scroll").evaluate(scroller => {
				const cells = Array.from(scroller.querySelectorAll("th, td"))
				const metadataContained = Array.from(scroller.querySelectorAll("dl")).every(element => {
					const cell = element.closest("td")!.getBoundingClientRect()
					const range = document.createRange()
					range.selectNodeContents(element)
					return Array.from(range.getClientRects()).every(rect => rect.left >= cell.left - 1 && rect.right <= cell.right + 1)
				})
				return { metadataContained, cellOverflow: Math.max(...cells.map(cell => cell.scrollWidth - cell.clientWidth)) }
			})
			expect(geometry).toEqual({ metadataContained: true, cellOverflow: expect.any(Number) })
			expect(geometry.cellOverflow).toBeLessThanOrEqual(1)
			expect(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth)).toBe(true)
			// The diagnostic's Copy button stays at body size, below the Check Now headline.
			expect(await panel(page).getByRole("button", { name: "Copy diagnostic" }).evaluate(button =>
				parseFloat(getComputedStyle(button).fontSize) <= parseFloat(getComputedStyle(document.documentElement).fontSize))).toBe(true)
			const screenshot = testInfo.outputPath(`dependencies-${theme}-${width}-${zoom}.png`)
			await writeFile(screenshot, (await captureNative(app, page, width, height))!)
			await testInfo.attach(`dependencies-${theme}-${width}-${zoom}.png`, { path: screenshot, contentType: "image/png" })
		}
	})
}
