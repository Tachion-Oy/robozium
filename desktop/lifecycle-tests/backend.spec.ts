import { expect, test as base, type ElectronApplication } from "@playwright/test"
import { execFileSync, spawnSync, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import net from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { captureNative, documentUrl } from "../tests/native"
import { expectFooterGeometry } from "../tests/footer-geometry"
import { resolveBackendLayout } from "../src/backend-layout.cjs"
import { installTestClient } from "../tests/transport"

const desktop = path.resolve(__dirname, "..")
const docker = execFileSync("which", ["docker"], { encoding: "utf8" }).trim()
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
const test = base.extend<{ runtime: { directory: string; profile: string; port: number; launch: () => Promise<ElectronApplication> } }>({
	runtime: async ({ playwright }, use, testInfo) => {
		const directory = await mkdtemp(path.join(tmpdir(), "robozium-native-backend-"))
		const profile = path.join(directory, "profile")
		const server = net.createServer()
		await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
		const port = (server.address() as net.AddressInfo).port
		await new Promise<void>(resolve => server.close(() => resolve()))
		const apps: { app: ElectronApplication; child: ChildProcess }[] = [], logs: string[] = []
		try {
			await mkdir(path.join(directory, "bin"))
			await use({ directory, profile, port, launch: async () => {
				const app = await playwright._electron.launch({
					args: [desktop, "--mock", "--ozone-platform=x11", "--force-device-scale-factor=1"],
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
						try { await app.close() }
						finally {
							if (child.exitCode === null && child.signalCode === null) {
								const exited = once(child, "exit"); child.kill("SIGKILL"); await exited
							}
						}
					}
				}
			} finally {
				await testInfo.attach("electron.log", { body: logs.join(""), contentType: "text/plain" })
				try {
					const installation = (await readFile(path.join(profile, "backend-installation-id"), "utf8")).trim()
					expect(installation).toMatch(/^[a-f0-9]{12}$/)
					const project = `robozium-desktop-${installation}-mock`
					const ids = execFileSync(docker, ["ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`], { encoding: "utf8" }).trim().split(/\s+/).filter(Boolean)
					for (const id of ids) {
						expect(execFileSync(docker, ["inspect", "--format", '{{index .Config.Labels "fi.tachion.robozium.desktop.installation"}}', id], { encoding: "utf8" }).trim()).toBe(installation)
						const logs = spawnSync(docker, ["logs", id], { encoding: "utf8", timeout: 15_000 })
						await testInfo.attach(`api-${id}.log`, { body: logs.stdout + logs.stderr, contentType: "text/plain" })
						execFileSync(docker, ["rm", "--force", id], { stdio: "pipe" })
					}
					try { execFileSync(docker, ["image", "rm", `${project}-api`], { stdio: "pipe" }) } catch { /* Startup may not have built an image. */ }
					let buildLog = ""
					try {
						buildLog = await readFile(resolveBackendLayout(path.join(profile, "mock")).dockerLog, "utf8")
					} catch {
						// Startup may fail before a Docker log exists.
					}
					await testInfo.attach("docker.log", { body: buildLog, contentType: "text/plain" })
				} finally { await rm(directory, { recursive: true, force: true }) }
			}
		}
	},
})

async function closeWindow(app: ElectronApplication) {
	const exited = once(app.process(), "exit")
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
	expect(await exited).toEqual([0, null])
}

test("native launch retries Docker, preserves projects after close, and reuses its image", async ({ runtime }, testInfo) => {
	const { directory, profile, port } = runtime
	const enabled = path.join(directory, "enabled"), commands = path.join(directory, "commands")
	await writeFile(path.join(directory, "bin/docker"), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${shellQuote(commands)}\nif [ "$1" = info ] && [ ! -f ${shellQuote(enabled)} ]; then exit 1; fi\nexec ${shellQuote(docker)} "$@"\n`, { mode: 0o700 })
	const app = await runtime.launch()
	const page = await app.firstWindow()
	await expect(page.getByRole("alert")).toContainText("Docker is unavailable")
	await expect(page.getByRole("button", { name: "Start run", exact: true })).toHaveCount(0)
	await app.evaluate(({ BrowserWindow }) => {
		const window = BrowserWindow.getAllWindows()[0]
		window.setContentSize(640, 420)
		window.webContents.setZoomFactor(1.25)
	})
	await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([512, 336])
	expect(await page.evaluate(() => document.documentElement.scrollHeight === innerHeight)).toBe(true)
	const retry = await page.getByRole("button", { name: "Retry", exact: true }).boundingBox()
	expect(retry!.height).toBeGreaterThan(24)
	expect(retry!.height).toBeLessThan(60)
	const screenshot = testInfo.outputPath("startup-error.png")
	await writeFile(screenshot, (await captureNative(app, page, 640, 420))!)
	await testInfo.attach("startup-error.png", { path: screenshot, contentType: "image/png" })
	await writeFile(enabled, "retry")
	let blocked = true, readinessRequests = 0
	const abortedReady = page.waitForEvent("requestfailed", request => request.url() === `http://127.0.0.1:${port}/ready`)
	await page.route(`http://127.0.0.1:${port}/ready`, async route => {
		readinessRequests++
		if (!blocked) await route.continue() // Stall initial readiness to exercise its timeout/abort.
	})
	await page.getByRole("button", { name: "Retry", exact: true }).click()
	await expect(page.getByRole("alert")).toContainText("Backend connection unavailable", { timeout: 180_000 })
	await expect(page.getByRole("button", { name: "Start run", exact: true })).toHaveCount(0)
	await abortedReady
	expect(readinessRequests).toBe(1)
	await page.clock.install()
	await page.clock.fastForward(20_000)
	expect(readinessRequests).toBe(1)
	const commandsBeforeRetry = await readFile(commands, "utf8")
	blocked = false
	await page.getByRole("button", { name: "Retry", exact: true }).click()
	await expect(page.getByRole("button", { name: "Start run", exact: true })).toBeVisible({ timeout: 180_000 })
	expect(await readFile(commands, "utf8")).toBe(commandsBeforeRetry)
	expect(await page.evaluate(() => window.robozium.getBackendConnection())).toEqual({ baseUrl: `http://127.0.0.1:${port}` })
	await installTestClient(page, `http://127.0.0.1:${port}`)
	const streamed = await page.evaluate(async () => {
		await window.testApi.request("/projects", { method: "POST", json: { name: "Transport run" } })
		const created = await window.testApi.request("/run/create", { method: "POST", json: { project: "transport-run" } }) as { run_id: string }
		const controller = new AbortController()
		try {
			for await (const event of window.testApi.streamRunEvents(created.run_id, controller.signal)) {
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
	const installation = (await readFile(path.join(profile, "backend-installation-id"), "utf8")).trim()
	const project = `robozium-desktop-${installation}-mock`
	const container = execFileSync(docker, ["ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`], { encoding: "utf8" }).trim()
	// A duplicate launch cannot take ownership or stop the first app's API.
	execFileSync(app.process().spawnfile, [desktop, "--mock", "--ozone-platform=x11"], {
		env: { ...process.env, ROBOZIUM_DESKTOP_TEST_DATA: profile }, cwd: directory, timeout: 15_000, stdio: "pipe",
	})
	expect(execFileSync(docker, ["inspect", "--format", "{{.State.Running}}", container], { encoding: "utf8" }).trim()).toBe("true")
	const image = execFileSync(docker, ["image", "inspect", "--format", "{{.Id}}", `${project}-api`], { encoding: "utf8" }).trim()
	await page.getByRole("button", { name: "Start run", exact: true }).click()
	const reply = page.getByRole("textbox", { name: "Reply", exact: true })
	await reply.fill("retained across outage")
	await reply.evaluate(element => Reflect.set(window, "originalEditor", element))
	await page.getByRole("button", { name: "Previous agent message", exact: true }).click()
	await page.getByRole("button", { name: "Move panel divider up" }).click()
	const model = page.getByRole("combobox", { name: /^Base model:/ })
	await model.press("End"); await model.press("Enter")
	const chosenModel = await model.getAttribute("title")
	// Stop this disposable backend externally; connection Retry must not restart it.
	execFileSync(docker, ["stop", "--time", "5", container], { stdio: "pipe" })
	await expect(page.getByRole("alert")).toContainText("Backend connection unavailable", { timeout: 12_000 })
	const outageCommands = await readFile(commands, "utf8")
	await page.getByRole("button", { name: "Retry", exact: true }).click()
	await expect(page.getByRole("alert")).toContainText("Backend connection unavailable")
	expect(await readFile(commands, "utf8")).toBe(outageCommands)
	for (const theme of ["dark", "light"]) {
		if (theme === "light") await page.getByRole("button", { name: "Toggle color theme" }).click()
		for (const [width, height, zoom] of [[1260, 780, 1], [640, 420, 1], [640, 420, 1.25]]) {
			await app.evaluate(({ BrowserWindow }, { width, height, zoom }) => {
				const window = BrowserWindow.getAllWindows()[0]
				window.setContentSize(width, height); window.webContents.setZoomFactor(zoom)
			}, { width, height, zoom })
			await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([width / zoom, height / zoom])
			await expectFooterGeometry(page)
			const bounds = await page.locator(".backend-notice").evaluate(notice => {
				const rect = notice.getBoundingClientRect()
				return { contained: rect.x >= 0 && rect.right <= innerWidth && rect.y >= 0 && rect.bottom <= innerHeight,
					noOverflow: document.documentElement.scrollHeight === innerHeight && document.documentElement.scrollWidth === innerWidth }
			})
			expect(bounds).toEqual({ contained: true, noOverflow: true })
			const screenshot = testInfo.outputPath(`outage-${theme}-${width}-${zoom}.png`)
			await writeFile(screenshot, (await captureNative(app, page, width, height))!)
			await testInfo.attach(path.basename(screenshot), { path: screenshot, contentType: "image/png" })
		}
	}
	execFileSync(docker, ["start", container], { stdio: "pipe" })
	await expect.poll(async () => {
		try { return (await fetch(`http://127.0.0.1:${port}/ready`, { headers: { Origin: "robozium://app" } })).status } catch { return 0 }
	}, { timeout: 30_000 }).toBe(200)
	await page.getByRole("button", { name: "Retry", exact: true }).click()
	await expect(page.locator(".backend-notice")).toHaveCount(0)
	await expect(reply).toHaveValue("retained across outage")
	expect(await reply.evaluate(element => element === Reflect.get(window, "originalEditor"))).toBe(true)
	await expect(page.getByRole("region", { name: "Agent message text", exact: true })).toContainText("Planning the next steps.")
	await expect(page.getByRole("group", { name: "Panel divider: equal" })).toBeVisible()
	await expect(model).toHaveAttribute("title", chosenModel!)
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
	const recoveredRequests = readinessRequests
	await expect.poll(() => readinessRequests, { timeout: 7000 }).toBeGreaterThan(recoveredRequests)
	const request = async (route: string, options?: RequestInit) => {
		const response = await fetch(`http://127.0.0.1:${port}${route}`, { ...options, headers: { ...options?.headers, Origin: "robozium://app", Connection: "close" }, signal: AbortSignal.timeout(10_000) })
		expect(response.status).toBe(200)
		return response.json()
	}
	const created = await request("/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Native lifecycle" }) })
	const proof = path.join(profile, "mock/hub/projects", created.slug, "proof.txt")
	await writeFile(proof, "native data survives shutdown\n")
	await closeWindow(app)
	expect(execFileSync(docker, ["inspect", "--format", "{{.State.Running}}", container], { encoding: "utf8" }).trim()).toBe("false")
	expect(await readFile(proof, "utf8")).toBe("native data survives shutdown\n")
	const reopened = await runtime.launch()
	await expect((await reopened.firstWindow()).getByRole("button", { name: "Start run", exact: true })).toBeVisible({ timeout: 30_000 })
	expect((await request("/projects")).some((item: { slug: string }) => item.slug === created.slug)).toBe(true)
	expect(execFileSync(docker, ["image", "inspect", "--format", "{{.Id}}", `${project}-api`], { encoding: "utf8" }).trim()).toBe(image)
	expect((await readFile(commands, "utf8")).split("\n").filter(line => line.endsWith(" build api"))).toHaveLength(1)
	await closeWindow(reopened)
	expect(await readFile(proof, "utf8")).toBe("native data survives shutdown\n")
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
