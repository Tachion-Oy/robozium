// Adapted from robozium-electron/desktop/tests/message-log-window.test.cjs at 076b2c9:
// Playwright instead of node:test, plus window limits, zoom, shortcuts and settings.
import { expect, test } from "@playwright/test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { LOG_SIDE_WIDTH, LOG_STACK_HEIGHT, MessageLogWindow, logWindowSize } from "../src/message-log-window"
import { readSettings, saveSettings } from "../src/settings"
import { boundedSize, nextZoom, windowLimits, zoomShortcut, type ZoomInput } from "../src/window"

function fixture(area = { x: 0, y: 0, width: 1920, height: 1080 }) {
	let size = { width: 900, height: 650 }
	let position = { x: 900, y: 100 }
	let zoom = 1
	const window = {
		getBounds: () => ({ ...position, width: size.width, height: size.height + 30 }),
		getContentBounds: () => ({ ...position, ...size }),
		getContentSize: () => [size.width, size.height],
		setContentSize: (width: number, height: number) => { size = { width, height }; dock.resized() },
		setPosition: (x: number, y: number) => { position = { x, y } },
		webContents: { getZoomFactor: () => zoom },
	}
	const dock = new MessageLogWindow(window, () => ({ workArea: area }))
	return { window, dock, zoom: (value: number) => { zoom = value } }
}

test("opening grows only enough for readable panes and closing restores the original size", () => {
	const { dock, window } = fixture()
	dock.setOpen(true)
	expect(window.getContentSize()).toEqual([1120, 650])
	expect(dock.savedSize(), "Temporary expansion is not persisted").toEqual({ width: 900, height: 650 })
	expect(window.getBounds().x + window.getBounds().width).toBeLessThanOrEqual(1920)
	dock.setOpen(false)
	expect(window.getContentSize()).toEqual([900, 650])
})

test("an already sufficient window remains unchanged", () => {
	const { dock, window } = fixture()
	window.setContentSize(1260, 780)
	dock.setOpen(true)
	expect(window.getContentSize()).toEqual([1260, 780])
})

test("manual resizing while open retains and persists the user's size", () => {
	const { dock, window } = fixture()
	dock.setOpen(true)
	window.setContentSize(1300, 720)
	expect(dock.savedSize()).toEqual({ width: 1300, height: 720 })
	dock.setOpen(false)
	expect(window.getContentSize()).toEqual([1300, 720])
})

test("zoom increases physical requirements without changing text size", () => {
	const { dock, window, zoom } = fixture()
	zoom(1.25)
	dock.setOpen(true)
	expect(window.getContentSize()).toEqual([1400, 650])
	zoom(1.5)
	dock.expand()
	expect(window.getContentSize()).toEqual([1680, 650])
	dock.setOpen(false)
	expect(window.getContentSize()).toEqual([900, 650])
})

test("small monitors gain only the height required for the stacked layout", () => {
	const { dock, window } = fixture({ x: 0, y: 0, width: 1024, height: 768 })
	window.setContentSize(640, 420)
	dock.setOpen(true)
	expect(window.getContentSize()).toEqual([640, 560])
	dock.setOpen(false)
	expect(window.getContentSize()).toEqual([640, 420])
})

test("a very small work area caps automatic growth and leaves scrolling to the renderer", () => {
	expect(logWindowSize({ width: 540, height: 350 }, { width: 540, height: 360 }, 1.25)).toEqual({ width: 540, height: 360 })
})

test("repeated toggles are idempotent and invalid IPC payloads cannot resize the window", () => {
	const { dock, window } = fixture()
	for (const input of [null, {}, 1, "true"]) expect(() => dock.setOpen(input)).toThrow(/Invalid message log state/)
	dock.setOpen(true)
	dock.setOpen(true)
	dock.setOpen(false)
	dock.setOpen(false)
	expect(window.getContentSize()).toEqual([900, 650])
})

test("the log's window minima match the desktop.css pane layout", async () => {
	const css = await readFile(path.join(__dirname, "../renderer/src/ui/styles/desktop.css"), "utf8")
	expect(css).toContain("grid-template-columns: minmax(640px, 3fr) minmax(480px, 2fr)")
	expect(css).toContain(`@container desktop-workspace (width < ${LOG_SIDE_WIDTH}px)`)
	expect(css).toContain("grid-template-rows: minmax(336px, 3fr) minmax(224px, 2fr)")
	expect(css).toContain(`min-height: ${LOG_STACK_HEIGHT}px`)
})

test("window sizes stay within 640x420 and 90% of the work area", () => {
	const limits = windowLimits({ width: 1920, height: 1080 })
	expect(limits).toEqual({ minWidth: 640, minHeight: 420, maxWidth: 1728, maxHeight: 972 })
	expect(boundedSize({ width: 300, height: 5000 }, limits)).toEqual({ width: 640, height: 972 })
	expect(boundedSize({ width: 1000.4, height: 700.6 }, limits)).toEqual({ width: 1000, height: 701 })
	expect(windowLimits({ width: 600, height: 400 })).toEqual({ minWidth: 540, minHeight: 360, maxWidth: 540, maxHeight: 360 })
	expect(() => boundedSize({ width: Number.NaN, height: 1 }, limits)).toThrow("Invalid window size.")
})

test("zoom moves in tenths between 0.5 and 3 and resets to 1", () => {
	expect(nextZoom(1, 1)).toBe(1.1)
	expect(nextZoom(1.1, -1)).toBe(1)
	expect(nextZoom(0.5, -1)).toBe(0.5)
	expect(nextZoom(3, 1)).toBe(3)
	expect(nextZoom(2.4, 0)).toBe(1)
})

test("zoom shortcuts use Command on macOS and Control elsewhere", () => {
	const key = (key: string, modifiers: Partial<ZoomInput> = {}, code = ""): ZoomInput =>
		({ type: "keyDown", key, code, control: false, meta: false, alt: false, isComposing: false, ...modifiers })
	expect(zoomShortcut(key("=", { control: true }), "linux")).toBe(1)
	expect(zoomShortcut(key("+", { control: true }, "NumpadAdd"), "linux")).toBe(1)
	expect(zoomShortcut(key("-", { control: true }), "linux")).toBe(-1)
	expect(zoomShortcut(key("0", { control: true }), "linux")).toBe(0)
	expect(zoomShortcut(key("=", { meta: true }), "darwin")).toBe(1)
	expect(zoomShortcut(key("=", { meta: true }), "linux")).toBeNull()
	expect(zoomShortcut(key("=", { control: true }), "darwin")).toBeNull()
	expect(zoomShortcut(key("=", { control: true, alt: true }), "linux")).toBeNull()
	expect(zoomShortcut(key("=", { control: true, isComposing: true }), "linux")).toBeNull()
	expect(zoomShortcut({ ...key("=", { control: true }), type: "keyUp" }, "linux")).toBeNull()
	expect(zoomShortcut(key("a", { control: true }), "linux")).toBeNull()
})

test("settings keep other keys and fall back per preference", async () => {
	const profile = await mkdtemp(path.join(tmpdir(), "robozium-settings-"))
	try {
		const file = path.join(profile, "settings.json")
		expect(readSettings(profile)).toEqual({ theme: "dark", window: null, zoom: 1 })
		await writeFile(file, JSON.stringify({ future: "kept", theme: "light", window: { width: 1000, height: 700 }, zoom: 1.2 }))
		expect(readSettings(profile)).toEqual({ theme: "light", window: { width: 1000, height: 700 }, zoom: 1.2 })
		saveSettings(profile, { zoom: 1.3 })
		expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ future: "kept", theme: "light", window: { width: 1000, height: 700 }, zoom: 1.3 })
		await writeFile(file, JSON.stringify({ theme: "blue", window: { width: "wide", height: 700 }, zoom: 9 }))
		expect(readSettings(profile)).toEqual({ theme: "dark", window: null, zoom: 1 })
		await writeFile(file, JSON.stringify({ theme: "light", window: { width: -1, height: 700 }, zoom: 0.4 }))
		expect(readSettings(profile)).toEqual({ theme: "light", window: null, zoom: 1 })
		await writeFile(file, "{ not json")
		expect(readSettings(profile)).toEqual({ theme: "dark", window: null, zoom: 1 })
		expect(() => saveSettings(profile, { zoom: 1.1 })).toThrow()
		expect(await readFile(file, "utf8")).toBe("{ not json")
	} finally { await rm(profile, { recursive: true, force: true }) }
})
