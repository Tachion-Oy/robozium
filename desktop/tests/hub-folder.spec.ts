import { expect, type ElectronApplication, type Page } from "@playwright/test"
import { test, json, view } from "./run-fixture"
import type { Backend } from "./selection-fixture"

type Pick = { folder: string; needsConfirmation: boolean } | { refused: string } | null
const environment = { revision: "r1", entries: [], overrides: [], requires_password: false, editable: true, suggestions: [], example_errors: [], imports: [] }
const panel = (page: Page) => page.getByRole("region", { name: "Environment settings" })
const hubInput = (page: Page) => panel(page).getByRole("textbox", { name: "Hub folder" })

/**
 * Stand in for an installed live launch, which owns a user hub folder: main's hub
 * operations with the native dialog's pick scripted. Main's checks are unit-tested.
 */
async function installedHub(app: ElectronApplication, current: string | null, selected: string | null) {
	await app.evaluate(({ ipcMain }, initial) => {
		const state = { ...initial, pick: null as Pick, used: [] as string[] }
		Reflect.set(globalThis, "hubFolder", state)
		const status = () => ({ current: state.current, selected: state.selected, choosable: true })
		for (const channel of ["hub-folder", "choose-hub-folder", "use-hub-folder"]) ipcMain.removeHandler(`desktop:${channel}`)
		ipcMain.handle("desktop:hub-folder", status)
		ipcMain.handle("desktop:choose-hub-folder", () => {
			if (state.pick && "refused" in state.pick) throw new Error(state.pick.refused)
			return state.pick
		})
		ipcMain.handle("desktop:use-hub-folder", () => {
			if (state.pick && "folder" in state.pick) {
				state.selected = state.pick.folder
				state.used.push(state.pick.folder)
			}
			return status()
		})
	}, { current, selected })
}
const pickNext = (app: ElectronApplication, pick: Pick) =>
	app.evaluate((_electron, pick) => { Reflect.get(globalThis, "hubFolder").pick = pick }, pick)
const used = (app: ElectronApplication) => app.evaluate(() => Reflect.get(globalThis, "hubFolder").used as string[])

async function openEnvironment(page: Page, backend: Backend) {
	backend.handlers.set("GET /credentials/environment", response => json(response, environment))
	await backend.open()
	await view(page, "Environment")
	await expect(panel(page)).toBeVisible()
}

test("a preview keeps a hub of its own and offers no choice", async ({ desktop: { page }, backend }) => {
	await openEnvironment(page, backend)
	await expect(panel(page)).toContainText("Mock mode and previews keep a throwaway hub of their own, so no other hub folder can be used.")
	await expect(panel(page).getByRole("button", { name: "Choose folder…" })).toHaveCount(0)
	await expect(panel(page).getByRole("button", { name: "Open folder" })).toBeDisabled()
})

test("the hub folder shows in full and changes with the native picker after a restart", async ({ desktop: { app, page }, backend }) => {
	await installedHub(app, "/home/user/Robozium-Hub", "/home/user/Robozium-Hub")
	await openEnvironment(page, backend)
	await expect(hubInput(page)).toHaveValue("/home/user/Robozium-Hub")
	await expect(panel(page).getByRole("button", { name: "Open folder" })).toBeEnabled()
	await expect(panel(page).getByRole("status").filter({ hasText: "Restart to apply your changes." })).toHaveCount(0)

	await pickNext(app, null)
	await panel(page).getByRole("button", { name: "Choose folder…" }).click()
	await expect(hubInput(page)).toHaveValue("/home/user/Robozium-Hub")
	expect(await used(app)).toEqual([])

	await pickNext(app, { folder: "/home/user/Projects/Robozium-Hub", needsConfirmation: false })
	await panel(page).getByRole("button", { name: "Choose folder…" }).click()
	await expect(hubInput(page)).toHaveValue("/home/user/Projects/Robozium-Hub")
	await expect(panel(page).getByRole("status").filter({ hasText: "Restart the app" }))
		.toHaveText("Restart the app to use this folder. Until then, the hub stays /home/user/Robozium-Hub.")
	// As after saving settings: a notification, and Restart app says it is needed.
	await expect(page.getByRole("status").filter({ hasText: "Hub folder chosen" }))
		.toContainText("/home/user/Projects/Robozium-Hub takes effect after restart.")
	await expect(panel(page).getByRole("status").filter({ hasText: "Restart to apply your changes." })).toBeVisible()
	expect(await used(app)).toEqual(["/home/user/Projects/Robozium-Hub"])
})

test("a folder with files but no projects is used only after confirming", async ({ desktop: { app, page }, backend }) => {
	await installedHub(app, "/home/user/Robozium-Hub", "/home/user/Robozium-Hub")
	await openEnvironment(page, backend)
	await pickNext(app, { folder: "/home/user/Documents", needsConfirmation: true })
	const choose = panel(page).getByRole("button", { name: "Choose folder…" })
	await choose.click()
	await expect(panel(page).getByRole("alert")).toHaveText("/home/user/Documents already has files but no Robozium projects. Use it as the hub folder anyway?")
	await expect(choose).toBeDisabled()
	await panel(page).getByRole("button", { name: "Cancel" }).click()
	expect(await used(app)).toEqual([])
	await expect(hubInput(page)).toHaveValue("/home/user/Robozium-Hub")

	await choose.click()
	await panel(page).getByRole("button", { name: "Use folder" }).click()
	await expect(hubInput(page)).toHaveValue("/home/user/Documents")
	expect(await used(app)).toEqual(["/home/user/Documents"])
})

test("a refused folder explains why in place", async ({ desktop: { app, page }, backend }) => {
	await installedHub(app, "/home/user/Robozium-Hub", "/home/user/Robozium-Hub")
	await openEnvironment(page, backend)
	await pickNext(app, { refused: "Hub folder /tmp/hub is a temporary folder that is cleared on restart. Choose another folder." })
	await panel(page).getByRole("button", { name: "Choose folder…" }).click()
	await expect(panel(page).getByRole("alert")).toHaveText("Hub folder /tmp/hub is a temporary folder that is cleared on restart. Choose another folder.")
	await expect(hubInput(page)).toHaveValue("/home/user/Robozium-Hub")
})

test("a missing hub folder stops startup, and choosing another retries", async ({ desktop: { app, page } }) => {
	await installedHub(app, null, "/media/drive/Robozium-Hub")
	await app.evaluate(({ ipcMain }) => {
		const missing = { state: "error", message: "Hub folder /media/drive/Robozium-Hub is missing. Reconnect it or choose another folder.", action: "choose-hub-folder" }
		let status: object = missing
		Reflect.set(globalThis, "retries", 0)
		for (const channel of ["backend-status", "retry-backend"]) ipcMain.removeHandler(`desktop:${channel}`)
		ipcMain.handle("desktop:backend-status", () => status)
		ipcMain.handle("desktop:retry-backend", () => {
			Reflect.set(globalThis, "retries", Reflect.get(globalThis, "retries") + 1)
			status = { state: "ready", message: "Backend ready" }
		})
	})
	await page.reload()
	await expect(page.getByRole("alert")).toHaveText("Hub folder /media/drive/Robozium-Hub is missing. Reconnect it or choose another folder.")
	await pickNext(app, { folder: "/home/user/Robozium-Hub", needsConfirmation: false })
	await page.getByRole("button", { name: "Choose folder…" }).click()
	await expect(page.locator(".agent-hud__box")).toBeVisible()
	expect(await used(app)).toEqual(["/home/user/Robozium-Hub"])
	expect(await app.evaluate(() => Reflect.get(globalThis, "retries"))).toBe(1)
})
