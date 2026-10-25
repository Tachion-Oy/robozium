import { _electron, expect, test as base, type ElectronApplication, type Page } from "@playwright/test"
import { once } from "node:events"
import type { ChildProcess } from "node:child_process"
import { createServer, type ServerResponse } from "node:http"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { locations } from "../src/backend-layout"

export const desktopRoot = path.resolve(import.meta.dirname, "..")
// Use Xvfb even when the host has Wayland; keep screenshot density reproducible.
export const launchArgs = (backendUrl: string) =>
	[desktopRoot, `--backend-url=${backendUrl}`, "--ozone-platform=x11", "--force-device-scale-factor=1"]
export const documentUrl = "robozium://app/index.html"
export const preload = path.join(desktopRoot, "dist", locations.preload)

export function json(response: ServerResponse, body: unknown, status = 200) {
	response.writeHead(status, { "Content-Type": "application/json" })
	response.end(JSON.stringify(body))
}
export type Handler = (response: ServerResponse, body: unknown) => void
/** The HTTP backend every launch connects to; tests change its handlers and read its requests. */
export interface FakeBackend {
	url: string
	handlers: Map<string, Handler>
	requests: { method: string; path: string; body: unknown }[]
}

const mockModels = [
	{ model_id: "mock", label: "Mock model" },
	{ model_id: "mock-fast", label: "Mock fast model" },
	{ model_id: "mock-extended", label: "Mock extended context model" },
]
/**
 * The preview run's history; its last message is the prompt the run awaits a reply to.
 * Markdown hard breaks (a trailing backslash) keep each sentence on its own line.
 */
export const previewMessages = [
	`Mock run created.

This run has three messages to explore.\\
Use the history arrows to move through them.\\
The first and latest buttons jump to either end.`,
	`Planning the next steps.

Start with the outcome, then list the constraints.\\
Your reply stays available while you browse earlier messages.`,
	`Mock run ready.

I can help you plan a task and review the next steps.

Describe what you want to accomplish in the reply below.\\
Include any constraints or details that matter to you.

You can move the panel divider to give the message or your draft more room.\\
Your draft stays here while you explore the other views.`,
]

/**
 * One dormant `preview` project whose launch opens a run awaiting a reply, and three
 * mock models. As in the real backend, the chosen model is kept.
 */
function previewHandlers(): Map<string, Handler> {
	let model = mockModels[0].model_id
	let launched = false
	const models = () => ({ models: mockModels, selected_model_id: model })
	const run = {
		project: "preview", status: "awaiting_user_input", error: null,
		message_trace: previewMessages.slice(0, -1).map((content, index) => ({
			type: "message", sequence: index + 1, message_id: `preview-${index + 1}`,
			payload: { role: "assistant", content, message_kind: "user_notification" },
		})),
		current_prompt_id: "preview-prompt", current_prompt: previewMessages.at(-1),
	}
	return new Map<string, Handler>([
		["GET /ready", response => json(response, { status: "ready" })],
		["GET /projects", response => json(response, [{
			slug: "preview", status: launched ? "awaiting_user_input" : "dormant", run_id: launched ? "preview-run" : null, created_at: null,
		}])],
		["GET /models", response => json(response, models())],
		["POST /models", (response, body) => {
			model = (body as { model_id: string }).model_id
			json(response, models())
		}],
		["GET /capabilities", response => json(response, [])],
		["POST /run/create", response => {
			launched = true
			json(response, { run_id: "preview-run" })
		}],
		["GET /run/preview-run", response => json(response, run)],
		["GET /run/preview-run/files", response => json(response, [])],
		["GET /run/preview-run/stream", response => {
			response.writeHead(200, { "Content-Type": "text/event-stream" })
			response.write(": open\n\n")
		}],
	])
}

/** Unsaved projects answer null and saves echo, unless a test sets an exact handler. */
function capabilityDefault(method: string, url: string): Handler | undefined {
	if (!/^\/capabilities\/[^/]+$/.test(url)) return undefined
	if (method === "GET") return response => json(response, null)
	if (method === "POST") return (response, body) => json(response, body)
	return undefined
}

export const test = base.extend<{ launchSwitches: string[]; fakeBackend: FakeBackend; desktop: { app: ElectronApplication; page: Page } }>({
	/** Extra Chromium switches, such as a fake microphone. */
	launchSwitches: [[], { option: true }],
	// eslint-disable-next-line no-empty-pattern -- Playwright fixtures must destructure their first argument.
	fakeBackend: async ({}, use) => {
		const handlers = previewHandlers()
		const requests: FakeBackend["requests"] = []
		const server = createServer(async (request, response) => {
			response.setHeader("Access-Control-Allow-Origin", "robozium://app")
			if (request.method === "OPTIONS") {
				response.setHeader("Access-Control-Allow-Headers", "Content-Type")
				response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE")
				response.end()
				return
			}
			// Recorded on arrival, so a test that clears the list never sees an earlier request.
			const entry: FakeBackend["requests"][number] = { method: request.method!, path: request.url!, body: undefined }
			requests.push(entry)
			const chunks: Buffer[] = []
			for await (const chunk of request) chunks.push(chunk as Buffer)
			const bytes = Buffer.concat(chunks)
			const type = request.headers["content-type"] ?? ""
			// Image uploads stay bytes and multipart uploads raw text; everything else this app sends is JSON.
			entry.body = !bytes.length ? undefined : type === "application/octet-stream" ? bytes
				: type.startsWith("multipart/") ? bytes.toString() : JSON.parse(bytes.toString())
			// A handler for the exact URL wins over one for its path without the query.
			const pathname = request.url!.split("?", 1)[0]
			const handler = handlers.get(`${request.method} ${request.url}`) ?? handlers.get(`${request.method} ${pathname}`)
				?? capabilityDefault(request.method!, request.url!)
			if (handler) handler(response, entry.body)
			else json(response, { detail: "Unexpected test request" }, 404)
		})
		server.listen(0, "127.0.0.1")
		await once(server, "listening")
		const address = server.address()
		if (!address || typeof address === "string") throw new Error("No test server port")
		try {
			await use({ url: `http://127.0.0.1:${address.port}`, handlers, requests })
		} finally {
			server.closeAllConnections()
			await new Promise<void>(resolve => server.close(() => resolve()))
		}
	},
	// A cold runner can take most of a test's budget to launch; time that apart.
	desktop: [async ({ playwright, launchSwitches, fakeBackend }, use, testInfo) => {
		const directory = await mkdtemp(path.join(tmpdir(), "robozium-scaffold-"))
		const logs: string[] = []
		let app: ElectronApplication | undefined
		let child: ChildProcess | undefined
		try {
			app = await playwright._electron.launch({
				args: [...launchArgs(fakeBackend.url), ...launchSwitches],
				chromiumSandbox: true,
				cwd: directory,
				env: { ...process.env, ROBOZIUM_DESKTOP_TEST_DATA: path.join(directory, "profile") },
				timeout: 15_000,
			})
			child = app.process()
			child.stdout?.on("data", chunk => logs.push(String(chunk)))
			child.stderr?.on("data", chunk => logs.push(String(chunk)))
			const page = await app.firstWindow()
			// The app shows its window once the startup screen is rendered; focus follows it.
			await expect.poll(() => app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(true)
			const errors: string[] = []
			page.on("pageerror", error => errors.push(error.message))
			// Actions wait for a stable element, and a reduced-motion change reaches the page
			// only with its next rendering update, so both need drawn frames.
			await waitForDrawing(app, page)
			await skipIntro(page)
			await expect(page.locator(".agent-hud__box")).toBeVisible()
			await expect(page.getByRole("button", { name: "Launch", exact: true })).toBeVisible()
			await use({ app, page })
			expect(errors).toEqual([])
		} finally {
			try {
				if (app && child?.exitCode === null && child.signalCode === null) {
					await app.close()
				}
			} finally {
				if (child?.exitCode === null && child.signalCode === null) {
					const exited = once(child, "exit")
					child.kill("SIGKILL")
					await exited
				}
				await testInfo.attach("electron.log", { body: logs.join(""), contentType: "text/plain" })
				await rm(directory, { recursive: true, force: true })
			}
		}
	}, { timeout: 60_000 }],
})

/** The startup screen has handed the window over to the application. */
export async function startupDone(page: Page) {
	await expect(page.locator(".startup")).toHaveCount(0)
}

/**
 * Reduced motion settles the launch animation, which startup.spec.ts covers
 * itself. The emulation ends with the startup screen, since reduced motion also
 * stills the HUD's own animations.
 */
export async function skipIntro(page: Page) {
	await page.emulateMedia({ reducedMotion: "reduce" })
	await startupDone(page)
	await page.emulateMedia({ reducedMotion: null })
}

/** Reload the document, skipping the launch animation it plays again. */
export async function reloadApp(page: Page) {
	await page.emulateMedia({ reducedMotion: "reduce" })
	await page.reload()
	await skipIntro(page)
}

/** Close through the native window, as a user does, then start again on the same profile and backend. */
export async function reopen(app: ElectronApplication, profile: string, backendUrl: string): Promise<ElectronApplication> {
	const exited = once(app.process(), "exit")
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
	expect(await exited).toEqual([0, null])
	return _electron.launch({
		args: launchArgs(backendUrl),
		chromiumSandbox: true,
		cwd: path.dirname(profile),
		env: { ...process.env, ROBOZIUM_DESKTOP_TEST_DATA: profile },
		timeout: 15_000,
	})
}

/** Header selectors are buttons named after their current value, with listbox menus. */
export const modelTrigger = (page: Page) => page.locator(".agent-hud__model-trigger:not(.agent-hud__view-trigger)")
export const viewTrigger = (page: Page) => page.locator(".agent-hud__view-trigger")

export async function chooseView(page: Page, name: string) {
	await viewTrigger(page).click()
	await page.getByRole("listbox", { name: "HUD view" }).getByRole("option", { name, exact: true }).click()
}

export async function chooseModel(page: Page, name: string) {
	await modelTrigger(page).click()
	await page.getByRole("listbox", { name: "Base model" }).getByRole("option", { name, exact: true }).click()
}

export async function waitForPanelLayout(page: Page) {
	await page.evaluate(async () => {
		await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
		// The activity logo pulses indefinitely; wait only for finite transitions.
		const animations = document.getAnimations()
			.filter(animation => animation.effect?.getTiming().iterations !== Infinity)
		await Promise.allSettled(animations.map(animation => animation.finished))
	})
}

/** Resolve once the renderer has drawn two frames; a hidden page draws none. */
const framesDrawn = (page: Page) => page.evaluate(() => new Promise<boolean>(resolve =>
	requestAnimationFrame(() => requestAnimationFrame(() => resolve(document.visibilityState === "visible")))))

/** The window's and renderer's state, so a failure on a CI runner can be diagnosed. */
async function describeWindow(app: ElectronApplication, page: Page): Promise<string> {
	const host = await app.evaluate(({ BrowserWindow }) => {
		const window = BrowserWindow.getAllWindows()[0]
		return {
			visible: window.isVisible(), focused: window.isFocused(), minimized: window.isMinimized(),
			contentSize: window.getContentSize(), zoomLevel: window.webContents.getZoomLevel(),
			painting: window.webContents.isPainting(),
		}
	})
	const renderer = await Promise.race([
		page.evaluate(() => ({ visibility: document.visibilityState, focus: document.hasFocus(), devicePixelRatio })),
		new Promise(resolve => setTimeout(() => resolve("no answer"), 2000)),
	])
	return `Window: ${JSON.stringify(host)}\nRenderer: ${JSON.stringify(renderer)}`
}

/**
 * The first launch on a cold CI runner can take many seconds to draw its first
 * frame, although its document is ready. Wait for two drawn frames, asking the
 * window to show and repaint after each second without one.
 */
async function waitForDrawing(app: ElectronApplication, page: Page) {
	const deadline = Date.now() + 60_000
	while (Date.now() < deadline) {
		const drawn = await Promise.race([framesDrawn(page), new Promise<false>(resolve => setTimeout(() => resolve(false), 1000))])
		if (drawn) return
		await app.evaluate(({ BrowserWindow }) => {
			const window = BrowserWindow.getAllWindows()[0]
			window.show()
			window.webContents.invalidate()
		})
	}
	throw new Error(`The page drew no frame within 60 seconds.\n${await describeWindow(app, page)}`)
}

export async function setNativeViewport(app: ElectronApplication, page: Page, width: number, height: number, zoom: number) {
	// Chromium holds new visual properties (size and zoom) until the renderer
	// acknowledges the previous ones with a frame, so start from a drawing page.
	await waitForDrawing(app, page)
	const previousZoom = await app.evaluate(({ BrowserWindow }, { width, height }) => {
		const window = BrowserWindow.getAllWindows()[0]
		const previousZoom = window.webContents.getZoomFactor()
		window.setContentSize(width, height)
		return previousZoom
	}, { width, height })
	// A pending native resize can overwrite a zoom set alongside it. Wait for
	// the renderer to observe the new dimensions before changing its zoom.
	await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight]))
		.toEqual([width / previousZoom, height / previousZoom])
	// A later native synchronization can still reset zoom after the size arrives.
	// Converge setup on both the actual zoom and renderer dimensions before testing.
	let stale = false
	try {
		await expect.poll(async () => {
			if (stale) {
				// A zoom the host recorded but the renderer never applied waits for a
				// frame: repaint the window and change the page so the renderer draws.
				await page.evaluate(() => {
					const root = document.documentElement
					root.style.opacity = root.style.opacity === "0.999" ? "" : "0.999"
				})
			}
			const factor = await app.evaluate(({ BrowserWindow }, { zoom, stale }) => {
				const contents = BrowserWindow.getAllWindows()[0].webContents
				// Setting the same factor again is a no-op, so change it first to force a reapply.
				if (stale) {
					contents.invalidate()
					contents.setZoomFactor(zoom === 1 ? 1.1 : 1)
				}
				contents.setZoomFactor(zoom)
				return contents.getZoomFactor()
			}, { zoom, stale })
			const size = await page.evaluate(() => [innerWidth, innerHeight])
			stale = factor === zoom && (size[0] !== width / zoom || size[1] !== height / zoom)
			return { factor, size }
		}).toEqual({ factor: zoom, size: [width / zoom, height / zoom] })
	} catch (error) {
		throw new Error(`${error instanceof Error ? error.message : String(error)}\n${await describeWindow(app, page)}`)
	} finally {
		await page.evaluate(() => { document.documentElement.style.opacity = "" })
	}
}

export async function captureNative(app: ElectronApplication, page: Page, width: number, height: number) {
	// Leaving a hovered control starts its transitions; let them finish too.
	await page.mouse.move(0, 0)
	await waitForPanelLayout(page)
	await page.evaluate(() => new Promise<void>(resolve =>
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
	// CDP screenshots crop at Electron zoom. Wait for the full native surface.
	let screenshot: Buffer | undefined
	await expect.poll(async () => {
		const capture = await app.evaluate(async ({ BrowserWindow }) => {
			const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage()
			return { size: image.getSize(), png: image.toPNG().toString("base64") }
		})
		screenshot = Buffer.from(capture.png, "base64")
		return capture.size
	}).toEqual({ width, height })
	return screenshot
}
