import { expect, test as base, type ElectronApplication, type Page } from "@playwright/test"
import { execFileSync, spawnSync, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import net from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { captureNative, chooseView, documentUrl, modelTrigger, setNativeViewport, toast } from "../tests/native"
import { expectFooterGeometry } from "../tests/footer-geometry"
import { resolveBackendLayout } from "../src/backend-layout"
import { installTestClient } from "../tests/transport"

const desktop = path.resolve(import.meta.dirname, "..")
const docker = execFileSync("which", ["docker"], { encoding: "utf8" }).trim()
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
// An 8×4 PNG.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAIAAAA8r+mnAAAAEUlEQVR4nGNQOJCAFTFQTwIAyM0oAY5QpvwAAAAASUVORK5CYII=", "base64")
interface Runtime {
	directory: string
	profile: string
	port: number
	commands: string
	/** Mock unless a test needs the live backend's own behavior, such as first-start setup. */
	launch: (mode?: "mock" | "live") => Promise<ElectronApplication>
}

const test = base.extend<{ runtime: Runtime }>({
	runtime: async ({ playwright }, use, testInfo) => {
		const directory = await mkdtemp(path.join(tmpdir(), "robozium-native-backend-"))
		const profile = path.join(directory, "profile")
		const commands = path.join(directory, "commands")
		const server = net.createServer()
		await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
		const port = (server.address() as net.AddressInfo).port
		await new Promise<void>(resolve => server.close(() => resolve()))
		const apps: { app: ElectronApplication; child: ChildProcess }[] = []
		const logs: string[] = []
		try {
			await mkdir(path.join(directory, "bin"))
			await writeFile(commands, "")
			await writeFile(path.join(directory, "bin/docker"), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${shellQuote(commands)}\nexec ${shellQuote(docker)} "$@"\n`, { mode: 0o700 })
			await use({ directory, profile, port, commands, launch: async (mode = "mock") => {
				const app = await playwright._electron.launch({
					args: [desktop, ...(mode === "mock" ? ["--mock"] : []), "--ozone-platform=x11", "--force-device-scale-factor=1"],
					chromiumSandbox: true, cwd: directory, timeout: 15_000,
					env: { ...process.env, PATH: `${directory}/bin:${process.env.PATH}`, ROBOZIUM_DESKTOP_TEST_DATA: profile, ROBOZIUM_DESKTOP_API_PORT: String(port) },
				})
				const child = app.process()
				apps.push({ app, child })
				child.stdout?.on("data", chunk => logs.push(String(chunk)))
				child.stderr?.on("data", chunk => logs.push(String(chunk)))
				return app
			} })
		} finally {
			try {
				for (const { app, child } of apps) {
					if (child.exitCode === null && child.signalCode === null) {
						try {
							await app.close()
						} finally {
							if (child.exitCode === null && child.signalCode === null) {
								const exited = once(child, "exit")
								child.kill("SIGKILL")
								await exited
							}
						}
					}
				}
			} finally {
				await testInfo.attach("electron.log", { body: logs.join(""), contentType: "text/plain" })
				try {
					const installation = (await readFile(path.join(profile, "backend-installation-id"), "utf8")).trim()
					expect(installation).toMatch(/^[a-f0-9]{12}$/)
					for (const mode of ["mock", "live"]) {
						const project = `robozium-desktop-${installation}-${mode}`
						const ids = execFileSync(docker, ["ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`], { encoding: "utf8" }).trim().split(/\s+/).filter(Boolean)
						for (const id of ids) {
							expect(execFileSync(docker, ["inspect", "--format", '{{index .Config.Labels "fi.tachion.robozium.desktop.installation"}}', id], { encoding: "utf8" }).trim()).toBe(installation)
							const logs = spawnSync(docker, ["logs", id], { encoding: "utf8", timeout: 15_000 })
							await testInfo.attach(`api-${id}.log`, { body: logs.stdout + logs.stderr, contentType: "text/plain" })
							execFileSync(docker, ["rm", "--force", id], { stdio: "pipe" })
						}
						try {
							execFileSync(docker, ["image", "rm", `${project}-api`], { stdio: "pipe" })
						} catch {
							// Startup may not have built an image in this mode.
						}
					}
					let buildLog = ""
					try {
						buildLog = await readFile(resolveBackendLayout(path.join(profile, "mock")).dockerLog, "utf8")
					} catch {
						// Startup may fail before a Docker log exists.
					}
					await testInfo.attach("docker.log", { body: buildLog, contentType: "text/plain" })
				} finally {
					await rm(directory, { recursive: true, force: true })
				}
			}
		}
	},
})

async function closeWindow(app: ElectronApplication) {
	const exited = once(app.process(), "exit")
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
	expect(await exited).toEqual([0, null])
}

async function launchConnected(runtime: Runtime) {
	const app = await runtime.launch()
	const page = await app.firstWindow()
	await expect(page.getByRole("button", { name: "New Project", exact: true })).toBeVisible({ timeout: 180_000 })
	return { app, page }
}

/** Create a project through the capability selector and launch it with the defaults. */
async function createAndLaunch(page: Page, name: string) {
	await page.getByRole("button", { name: "New Project", exact: true }).click()
	await page.getByRole("textbox", { name: "Project name" }).fill(name)
	await page.getByRole("form", { name: "Capability selector" }).getByRole("button", { name: "Launch", exact: true }).click()
}

async function ownedBackend(profile: string) {
	const installation = (await readFile(path.join(profile, "backend-installation-id"), "utf8")).trim()
	const project = `robozium-desktop-${installation}-mock`
	const container = execFileSync(docker, ["ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`], { encoding: "utf8" }).trim()
	return { project, container }
}

test("Docker startup failure presents an accessible retry that starts the backend", async ({ runtime }, testInfo) => {
	const { directory, commands } = runtime
	const enabled = path.join(directory, "enabled")
	await writeFile(path.join(directory, "bin/docker"), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${shellQuote(commands)}\nif [ "$1" = info ] && [ ! -f ${shellQuote(enabled)} ]; then exit 1; fi\nexec ${shellQuote(docker)} "$@"\n`, { mode: 0o700 })
	const app = await runtime.launch()
	const page = await app.firstWindow()
	// The failure shows in a toast over the loading screen once the launch animation has played.
	await expect(toast(page, "Robozium could not start")).toContainText("Docker is unavailable", { timeout: 15_000 })
	await expect(page.getByRole("button", { name: "New Project", exact: true })).toHaveCount(0)
	await setNativeViewport(app, page, 640, 420, 1.25)
	expect(await page.evaluate(() => document.documentElement.scrollHeight === innerHeight)).toBe(true)
	const retry = await page.getByRole("button", { name: "Retry", exact: true }).boundingBox()
	// About the 24px pointer target; zoomed layout lands a little either side of it.
	expect(retry!.height).toBeGreaterThan(22)
	expect(retry!.height).toBeLessThan(60)
	const screenshot = testInfo.outputPath("startup-error.png")
	await writeFile(screenshot, (await captureNative(app, page, 640, 420))!)
	await testInfo.attach("startup-error.png", { path: screenshot, contentType: "image/png" })
	await writeFile(enabled, "retry")
	await page.getByRole("button", { name: "Retry", exact: true }).click()
	await expect(page.getByRole("button", { name: "New Project", exact: true })).toBeVisible({ timeout: 180_000 })
})

test("initial renderer readiness times out, stops polling, and retries without Docker", async ({ runtime }) => {
	const { port, commands } = runtime
	const app = await runtime.launch()
	const page = await app.firstWindow()
	let blocked = true
	let readinessRequests = 0
	const abortedReady = page.waitForEvent("requestfailed", request => request.url() === `http://127.0.0.1:${port}/ready`)
	await page.route(`http://127.0.0.1:${port}/ready`, async route => {
		readinessRequests++
		// Leave the first request pending to exercise the renderer's timeout/abort.
		if (!blocked) await route.continue()
	})
	await test.step("Abort the timed-out request and stop polling", async () => {
		await expect(toast(page, "Backend")).toContainText("Backend connection unavailable", { timeout: 180_000 })
		await expect(page.getByRole("button", { name: "New Project", exact: true })).toHaveCount(0)
		await abortedReady
		expect(readinessRequests).toBe(1)
		await page.clock.install()
		await page.clock.fastForward(20_000)
		expect(readinessRequests).toBe(1)
	})
	await test.step("Retry the connection without issuing Docker commands", async () => {
		const commandsBeforeRetry = await readFile(commands, "utf8")
		blocked = false
		await page.getByRole("button", { name: "Retry", exact: true }).click()
		await expect(page.getByRole("button", { name: "New Project", exact: true })).toBeVisible()
		expect(await readFile(commands, "utf8")).toBe(commandsBeforeRetry)
	})
})

test("renderer HTTP and SSE use the selected backend allowed by CSP", async ({ runtime }) => {
	const { port } = runtime
	const { app, page } = await launchConnected(runtime)
	expect(await page.evaluate(() => window.robozium.getBackendConnection())).toEqual({ baseUrl: `http://127.0.0.1:${port}` })
	await installTestClient(page, `http://127.0.0.1:${port}`)
	const streamed = await page.evaluate(async () => {
		await window.testApi.request("/projects", { method: "POST", json: { name: "Transport run" } })
		const created = await window.testApi.request("/run/create", { method: "POST", json: { project: "transport-run" } }) as { run_id: string }
		const controller = new AbortController()
		try {
			for await (const event of window.testApi.streamEvents(`/run/${encodeURIComponent(created.run_id)}/stream`, controller.signal)) {
				return event
			}
		} finally {
			controller.abort()
			await window.testApi.request("/projects/transport-run/cancel", { method: "POST" })
		}
	})
	expect(streamed).toMatchObject({ type: expect.any(String) })
	const csp = await app.evaluate(async ({ net }, url) => {
		const response = await net.fetch(url)
		await response.body?.cancel()
		return response.headers.get("Content-Security-Policy")
	}, documentUrl)
	expect(csp?.split("; ")).toContain(`connect-src http://127.0.0.1:${port}`)
})

test("an outage preserves the HUD, and after recovery the lost run returns to the overview", async ({ runtime }, testInfo) => {
	const { profile, port, commands } = runtime
	const { app, page } = await launchConnected(runtime)
	const { container } = await ownedBackend(profile)
	let readinessRequests = 0
	let modelReads = 0
	page.on("request", request => {
		if (request.url() === `http://127.0.0.1:${port}/ready`) readinessRequests++
		if (request.method() === "GET" && request.url() === `http://127.0.0.1:${port}/models`) modelReads++
	})
	await createAndLaunch(page, "Outage project")
	const reply = page.getByRole("textbox", { name: "Reply text", exact: true })
	await reply.fill("retained across outage")
	await reply.evaluate(element => Reflect.set(window, "originalEditor", element))
	await expect(page.locator(".agent-hud__replyBox--agent .agent-hud__replyBox-scroll")).toContainText("Hello! I generated a text artifact")
	// Advance the isolated mock through HTTP; reply controls arrive in PR 9.
	const runId = (await (await fetch(`http://127.0.0.1:${port}/projects`, { headers: { Origin: "robozium://app" } })).json() as { slug: string; run_id: string }[])
		.find(project => project.slug === "outage-project")!.run_id
	await replyToMock(port, runId)
	await expect(page.locator(".agent-hud__replyBox--agent .agent-hud__replyBox-scroll")).toContainText("Thanks. One more thing")
	await page.getByRole("button", { name: "Previous agent message", exact: true }).click()
	const selectedOutput = await page.locator(".agent-hud__replyBox--agent .agent-hud__replyBox-scroll").textContent()
	await page.getByRole("button", { name: "Move panel divider up" }).click()
	const model = modelTrigger(page)
	await expect(model).toHaveAttribute("title", "Mock")
	await model.click()
	await page.getByRole("listbox", { name: "Base model" }).getByRole("option").last().click()
	const chosenModel = await model.getAttribute("title")
	await test.step("Detect the outage and retry without restarting Docker", async () => {
		// Stop this disposable backend externally; connection Retry must not restart it.
		execFileSync(docker, ["stop", "--time", "5", container], { stdio: "pipe" })
		await expect(toast(page, "Backend")).toContainText("Backend connection unavailable", { timeout: 12_000 })
		const outageCommands = await readFile(commands, "utf8")
		await page.getByRole("button", { name: "Retry", exact: true }).click()
		await expect(toast(page, "Backend")).toContainText("Backend connection unavailable")
		expect(await readFile(commands, "utf8")).toBe(outageCommands)
		// Run reads reconnect quietly while the backend is away; the HUD stays mounted.
		await expect(reply).toHaveValue("retained across outage")
		expect(await reply.evaluate(element => element === Reflect.get(window, "originalEditor"))).toBe(true)
		await expect(page.locator(".agent-hud__replyBox--agent .agent-hud__replyBox-scroll")).toHaveText(selectedOutput!)
		await expect(page.getByRole("group", { name: "Panel divider: equal" })).toBeVisible()
		await expect(page.getByRole("button", { name: "Retry output" })).toHaveCount(0)
	})
	await test.step("Check the outage notice in both themes, window sizes, and zoom levels", async () => {
		for (const theme of ["dark", "light"]) {
			if (theme === "light") await page.getByRole("button", { name: "Toggle color theme" }).click()
			for (const [width, height, zoom] of [[1260, 780, 1], [640, 420, 1], [640, 420, 1.25]]) {
				await setNativeViewport(app, page, width, height, zoom)
				await expectFooterGeometry(page)
				const contentHeights = await page.locator(".agent-hud__replyBox-scroll, .agent-hud__replyBox textarea")
					.evaluateAll(panels => panels.map(panel => panel.clientHeight))
				const bounds = await toast(page, "Backend").evaluate(notice => {
					const rect = notice.getBoundingClientRect()
					return { contained: rect.x >= 0 && rect.right <= innerWidth && rect.y >= 0 && rect.bottom <= innerHeight,
						noOverflow: document.documentElement.scrollHeight === innerHeight && document.documentElement.scrollWidth === innerWidth }
				})
				expect(bounds).toEqual({ contained: true, noOverflow: true })
				const screenshot = testInfo.outputPath(`outage-${theme}-${width}-${zoom}.png`)
				await writeFile(screenshot, (await captureNative(app, page, width, height))!)
				await testInfo.attach(path.basename(screenshot), { path: screenshot, contentType: "image/png" })
				expect(contentHeights.every(height => height >= 18), `${theme} ${width} ${zoom}: ${contentHeights}`).toBe(true)
			}
		}
	})
	await test.step("Recover: settings are kept and the run the restart lost returns to the overview", async () => {
		execFileSync(docker, ["start", container], { stdio: "pipe" })
		await expect.poll(async () => {
			try {
				return (await fetch(`http://127.0.0.1:${port}/ready`, { headers: { Origin: "robozium://app" } })).status
			} catch {
				return 0
			}
		}, { timeout: 30_000 }).toBe(200)
		const previousModelReads = modelReads
		await page.getByRole("button", { name: "Retry", exact: true }).click()
		await expect(toast(page, "Backend")).toHaveCount(0)
		await expect.poll(() => modelReads).toBeGreaterThan(previousModelReads)
		const row = page.locator(".agent-hud__project-row", { hasText: "outage-project" })
		await expect(row).toContainText("DORMANT", { timeout: 15_000 })
		await expect(reply).toHaveCount(0)
		await expect(model).toHaveAttribute("title", chosenModel!)
		await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
		const recoveredRequests = readinessRequests
		await expect.poll(() => readinessRequests, { timeout: 7000 }).toBeGreaterThan(recoveredRequests)
		// The unsent draft belonged to the lost run, so the next run starts empty.
		await row.getByRole("button", { name: "Launch", exact: true }).click()
		await expect(reply).toHaveValue("")
	})
})

test("a duplicate launch focuses the first window and cannot stop its backend", async ({ runtime }) => {
	const { app } = await launchConnected(runtime)
	const { container } = await ownedBackend(runtime.profile)
	// Count the first window's focus requests; window managers differ in what focus looks like.
	await app.evaluate(({ BrowserWindow }) => {
		const window = BrowserWindow.getAllWindows()[0]
		const focus = window.focus.bind(window)
		Reflect.set(globalThis, "focusRequests", 0)
		window.focus = () => { Reflect.set(globalThis, "focusRequests", Number(Reflect.get(globalThis, "focusRequests")) + 1); focus() }
	})
	execFileSync(app.process().spawnfile, [desktop, "--mock", "--ozone-platform=x11"], {
		env: { ...process.env, ROBOZIUM_DESKTOP_TEST_DATA: runtime.profile },
		cwd: runtime.directory, timeout: 15_000, stdio: "pipe",
	})
	await expect.poll(() => app.evaluate(() => Reflect.get(globalThis, "focusRequests"))).toBe(1)
	expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true)
	expect(execFileSync(docker, ["inspect", "--format", "{{.State.Running}}", container], { encoding: "utf8" }).trim()).toBe("true")
})

test("closing and reopening preserves project data and reuses the backend image", async ({ runtime }) => {
	const { profile, commands, port } = runtime
	const { app, page } = await launchConnected(runtime)
	const { project, container } = await ownedBackend(profile)
	const image = execFileSync(docker, ["image", "inspect", "--format", "{{.Id}}", `${project}-api`], { encoding: "utf8" }).trim()
	await createAndLaunch(page, "Native lifecycle")
	await expect(page.getByRole("status", { name: "Run status" })).toContainText("native-lifecycle")
	await chooseView(page, "Runs Overview")
	// A second project with the same name is refused, and the selector keeps the draft.
	await createAndLaunch(page, "Native lifecycle")
	await expect(page.getByRole("alert")).toContainText("Project already exists")
	await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue("Native lifecycle")
	await page.getByRole("form", { name: "Capability selector" }).getByRole("button", { name: "Cancel", exact: true }).click()
	await expect(page.getByRole("button", { name: "Open native-lifecycle", exact: true })).toBeVisible()
	const proof = path.join(profile, "mock/hub/projects/native-lifecycle/proof.txt")
	await writeFile(proof, "native data survives shutdown\n")
	await test.step("Close the window and retain the mounted project files", async () => {
		await closeWindow(app)
		expect(execFileSync(docker, ["inspect", "--format", "{{.State.Running}}", container], { encoding: "utf8" }).trim()).toBe("false")
		expect(await readFile(proof, "utf8")).toBe("native data survives shutdown\n")
	})
	await test.step("Reopen the installation and reuse its project and image", async () => {
		const reopened = await runtime.launch()
		const reopenedPage = await reopened.firstWindow()
		await expect(reopenedPage.getByRole("button", { name: "New Project", exact: true })).toBeVisible({ timeout: 30_000 })
		await installTestClient(reopenedPage, `http://127.0.0.1:${port}`)
		const projects = await reopenedPage.evaluate(async () => await window.testApi.request("/projects") as { slug: string }[])
		expect(projects.some(item => item.slug === "native-lifecycle")).toBe(true)
		// The run ended with the window: the project is dormant and launches again.
		await expect(reopenedPage.locator(".agent-hud__project-row", { hasText: "native-lifecycle" }).getByRole("button", { name: "Launch", exact: true })).toBeVisible()
		expect(execFileSync(docker, ["image", "inspect", "--format", "{{.Id}}", `${project}-api`], { encoding: "utf8" }).trim()).toBe(image)
		expect((await readFile(commands, "utf8")).split("\n").filter(line => line.endsWith(" build api"))).toHaveLength(1)
		await closeWindow(reopened)
		expect(await readFile(proof, "utf8")).toBe("native data survives shutdown\n")
	})
})

test("closing the native window cancels an in-progress build client", async ({ runtime }) => {
	const marker = path.join(runtime.directory, "build-pid")
	await writeFile(path.join(runtime.directory, "bin/docker"), `#!/bin/sh\ncase "$*" in\n  *" build api") echo $$ > ${shellQuote(marker)}; exec sleep 120;;\nesac\nexec ${shellQuote(docker)} "$@"\n`, { mode: 0o700 })
	const app = await runtime.launch()
	const page = await app.firstWindow()
	await expect(page.getByRole("status")).toContainText("Building the backend", { timeout: 15_000 })
	await expect.poll(async () => {
		try {
			return await readFile(marker, "utf8")
		} catch {
			return ""
		}
	}).toMatch(/^\d+\n$/)
	const pid = Number(await readFile(marker, "utf8"))
	await closeWindow(app)
	expect(() => process.kill(pid, 0)).toThrow()
})

async function replyToMock(port: number, runId: string) {
	const base = `http://127.0.0.1:${port}/run/${runId}`
	const headers = { Origin: "robozium://app", "Content-Type": "application/json" }
	const snapshot = await (await fetch(base, { headers })).json() as { current_prompt_id: string }
	expect(snapshot.current_prompt_id).toBeTruthy()
	const response = await fetch(`${base}/reply`, { method: "POST", headers,
		body: JSON.stringify({ prompt_id: snapshot.current_prompt_id, content: "Continue the mock" }) })
	expect(response.status).toBe(200)
}

test("UI starts a project run, answers its prompts and returns to the overview at completion", async ({ runtime }) => {
	const { app, page } = await launchConnected(runtime)
	let creates = 0
	let streams = 0
	page.on("request", request => {
		if (request.url().endsWith("/run/create")) creates++
		if (request.url().endsWith("/stream")) streams++
	})
	await createAndLaunch(page, "Desktop output")
	const output = page.locator(".agent-hud__replyBox--agent .agent-hud__replyBox-scroll")
	const status = page.getByRole("status", { name: "Run status" })
	await expect(output).toContainText("Hello! I generated a text artifact")
	await expect(status).toContainText("Awaiting input")
	// The artifact link opens the generated file from this installation's hub.
	await app.evaluate(({ shell }) => {
		const opened: string[] = []
		Reflect.set(globalThis, "openedPaths", opened)
		shell.openPath = async target => { opened.push(target); return "" }
	})
	await output.getByRole("link", { name: "Open the generated text file" }).click()
	await expect.poll(() => app.evaluate(() => Reflect.get(globalThis, "openedPaths"))).toEqual([
		expect.stringMatching(/\/hub\/projects\/desktop-output\/documents\/generated-note\.txt$/),
	])
	// Both prompts are answered through the HUD: Enter first, then Send.
	const reply = page.getByRole("textbox", { name: "Reply text", exact: true })
	await reply.fill("Continue the mock")
	await reply.press("Enter")
	await expect(output).toHaveText("Thanks. One more thing before I finish?")
	await expect(reply).toHaveValue("")
	// The last reply carries an image; the backend serves staged files to the renderer's previews.
	await page.getByLabel("Choose images").setInputFiles({ name: "mock.png", mimeType: "image/png", buffer: png })
	await reply.fill("Finish the mock")
	await expect(page.locator(".agent-hud__send")).toBeEnabled()
	expect(await page.evaluate(async () => {
		const { baseUrl } = (await window.robozium.getBackendConnection())!
		const runId = (await (await fetch(new URL("/projects", baseUrl))).json() as { slug: string; run_id: string }[])
			.find(project => project.slug === "desktop-output")!.run_id
		const [staged] = await (await fetch(new URL(`/run/${runId}/files`, baseUrl))).json() as { path: string }[]
		const image = new Image()
		image.crossOrigin = "anonymous"
		image.src = new URL(`/files/${staged.path}`, baseUrl).href
		await image.decode()
		return image.naturalWidth
	})).toBe(8)
	await page.locator(".agent-hud__send").click()
	await expect(page.locator(".agent-hud__project-row", { hasText: "desktop-output" })).toContainText("DORMANT")
	await expect(reply).toHaveCount(0)
	expect(creates).toBe(1)
	expect(streams).toBe(1)
	await closeWindow(app)
})

test("Cancel in the HUD cancels the run and returns to the overview", async ({ runtime }) => {
	const { app, page } = await launchConnected(runtime)
	let cancels = 0
	page.on("request", request => { if (request.url().endsWith("/cancel")) cancels++ })
	await createAndLaunch(page, "Desktop cancel")
	await expect(page.getByRole("status", { name: "Run status" })).toContainText("Awaiting input")
	await page.locator(".agent-hud__cancel").click()
	await expect(page.locator(".agent-hud__project-row", { hasText: "desktop-cancel" })).toContainText("DORMANT")
	await expect(page.getByRole("textbox", { name: "Reply text", exact: true })).toHaveCount(0)
	expect(cancels).toBe(1)
	await closeWindow(app)
})

test("encrypted secrets ask for their password after a restart and when launching", async ({ runtime }) => {
	const { port } = runtime
	const first = await launchConnected(runtime)
	await test.step("Save a throwaway secret, encrypted with a test password", async () => {
		await installTestClient(first.page, `http://127.0.0.1:${port}`)
		await first.page.evaluate(async () => {
			const view = await window.testApi.request("/credentials/environment") as { revision: string }
			await window.testApi.request("/credentials/environment", { method: "POST", json: {
				revision: view.revision, password: "lifecycle-test-password",
				entries: [{ name: "DESKTOP_LIFECYCLE_SECRET", value: "throwaway-value", secret: true }],
			} })
		})
		await closeWindow(first.app)
	})
	const { app, page } = await launchConnected(runtime)
	const unlock = page.getByRole("dialog", { name: "Unlock secrets" })
	await test.step("The password is asked for at start, and a cancelled launch is refused", async () => {
		await expect(unlock).toBeVisible()
		await unlock.getByRole("button", { name: "Cancel" }).click()
		await createAndLaunch(page, "Locked secrets")
		await unlock.getByRole("button", { name: "Cancel" }).click()
		await expect(page.getByRole("alert").filter({ hasText: "Secrets locked" })).toContainText("Unlock secrets before starting a run.")
	})
	await test.step("Launch again, unlock with the test password, and the run starts", async () => {
		await page.getByRole("form", { name: "Capability selector" }).getByRole("button", { name: "Launch", exact: true }).click()
		await unlock.getByLabel("Password").fill("wrong password")
		await unlock.getByLabel("Password").press("Enter")
		await expect(unlock.getByRole("alert")).toHaveText("Could not unlock secrets. Check the password and try again.")
		await unlock.getByLabel("Password").fill("lifecycle-test-password")
		await unlock.getByLabel("Password").press("Enter")
		await expect(page.getByRole("status", { name: "Run status" })).toContainText("locked-secrets")
	})
	await closeWindow(app)
})

test("a setting saved in Environment is stored by the backend and shown after reopening", async ({ runtime }) => {
	const first = await launchConnected(runtime)
	const panel = (page: Page) => page.getByRole("region", { name: "Environment settings" })
	await chooseView(first.page, "Environment")
	await panel(first.page).getByRole("button", { name: "Add variable" }).click()
	const editor = first.page.getByRole("form", { name: "Variable editor" })
	await editor.getByLabel("Name").fill("DESKTOP_LIFECYCLE_SETTING")
	await editor.getByLabel("Value for DESKTOP_LIFECYCLE_SETTING").fill("kept")
	await editor.getByRole("button", { name: "Apply" }).click()
	await first.page.getByRole("form", { name: "Save environment settings" }).getByRole("button", { name: "Save" }).click()
	await expect(first.page.getByRole("status").filter({ hasText: "Settings saved" })).toBeVisible()
	await closeWindow(first.app)
	const { app, page } = await launchConnected(runtime)
	await chooseView(page, "Environment")
	await expect(panel(page).getByLabel("Current value for DESKTOP_LIFECYCLE_SETTING")).toHaveText("kept")
	await closeWindow(app)
})

test("a secret saved in Environment applies after Restart app and a reset removes it", async ({ runtime }) => {
	const marker = path.join(runtime.directory, "relaunched")
	/** Playwright cannot follow a relaunched process; record the request, wait for a clean exit, then start again. */
	const restartApp = async (app: ElectronApplication, page: Page) => {
		await app.evaluate(({ app }, marker) => {
			app.relaunch = () => process.getBuiltinModule("fs").writeFileSync(marker, "relaunch")
		}, marker)
		const exited = once(app.process(), "exit")
		await page.getByRole("region", { name: "Environment settings" }).getByRole("button", { name: "Restart app" }).click()
		expect(await exited).toEqual([0, null])
		expect(await readFile(marker, "utf8")).toBe("relaunch")
		await rm(marker)
		return launchConnected(runtime)
	}
	const save = (page: Page) => page.getByRole("form", { name: "Save environment settings" })
	const unlock = (page: Page) => page.getByRole("dialog", { name: "Unlock secrets" })
	let { app, page } = await launchConnected(runtime)
	await test.step("Save a throwaway secret with a test password", async () => {
		await chooseView(page, "Environment")
		await page.getByRole("button", { name: "Add variable" }).click()
		const editor = page.getByRole("form", { name: "Variable editor" })
		await editor.getByLabel("Name").fill("DESKTOP_RESTART_SECRET")
		await editor.getByLabel("Value for DESKTOP_RESTART_SECRET").fill("throwaway-value")
		await editor.getByRole("checkbox", { name: "Secret" }).click()
		await editor.getByRole("button", { name: "Apply" }).click()
		await save(page).getByRole("button", { name: "Encrypt and save" }).click()
		const prompt = page.getByRole("dialog", { name: "Encrypt and save" })
		await prompt.getByLabel("Encryption password").fill("restart-test-password")
		await prompt.getByLabel("Confirm password").fill("restart-test-password")
		await prompt.getByRole("button", { name: "Encrypt and save" }).click()
		await expect(toast(page, "Restart required")).toContainText("Restart to apply")
	})
	await test.step("Restart app, then unlock and launch", async () => {
		;({ app, page } = await restartApp(app, page))
		await unlock(page).getByLabel("Password").fill("restart-test-password")
		await unlock(page).getByLabel("Password").press("Enter")
		await expect(unlock(page)).toHaveCount(0)
		await createAndLaunch(page, "Restarted secrets")
		await expect(page.getByRole("status", { name: "Run status" })).toContainText("restarted-secrets")
		await chooseView(page, "Runs Overview")
		await page.locator(".agent-hud__project-row", { hasText: "restarted-secrets" }).getByRole("button", { name: "Stop", exact: true }).click()
		await expect(page.locator(".agent-hud__project-row", { hasText: "restarted-secrets" })).toContainText("DORMANT", { timeout: 30_000 })
	})
	await test.step("Reset the environment and restart without secrets", async () => {
		await chooseView(page, "Environment")
		await save(page).getByRole("button", { name: "Reset environment" }).click()
		await toast(page, "Reset environment?").getByRole("button", { name: "Yes, reset" }).click()
		await expect(page.getByRole("status").filter({ hasText: "Environment reset" })).toBeVisible()
		;({ app, page } = await restartApp(app, page))
		// No password is asked for: the HUD under the startup screen stays usable.
		await page.getByRole("button", { name: "New Project", exact: true }).click()
		await expect(page.getByRole("form", { name: "Capability selector" })).toBeVisible()
		await expect(unlock(page)).toHaveCount(0)
	})
	await closeWindow(app)
})

test("a live start without keys opens on Start Here, and the guide explains the key file", async ({ runtime }) => {
	const app = await runtime.launch("live")
	const page = await app.firstWindow()
	await expect(page.getByRole("button", { name: "Start Here", exact: true })).toBeVisible({ timeout: 180_000 })
	await expect(page.getByRole("button", { name: "New Project", exact: true })).toHaveCount(0)
	await page.getByRole("button", { name: "Start Here", exact: true }).click()
	await page.getByRole("button", { name: "Next agent message", exact: true }).click()
	await expect(page.locator(".agent-hud__replyBox--agent")).toContainText("drop it on Key file")
	await closeWindow(app)
})
