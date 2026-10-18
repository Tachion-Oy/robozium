import { expect, test as base, type ElectronApplication } from "@playwright/test"
import { execFileSync, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { applicationPage, desktopRoot, documentUrl, setNativeViewport } from "./native"

// Isolate preparation outputs. Only the compiler/bundler boundary is substituted;
// the entry, process cancellation, sandbox, preload and HUD handoff stay real.
const test = base.extend<{ startup: {
	root: string
	launch: (preview?: boolean) => Promise<ElectronApplication>
} }>({
	startup: async ({ playwright }, use, testInfo) => {
		const root = await mkdtemp(path.join(tmpdir(), "robozium-startup-"))
		const applications: { app: ElectronApplication; child: ChildProcess }[] = []
		const logs: string[] = []
		try {
			for (const entry of ["src", "splash", "dist", "package.json"]) {
				await cp(path.join(desktopRoot, entry), path.join(root, entry), { recursive: true })
			}
			for (const directory of ["scripts", "node_modules/typescript/bin", "node_modules/vite/bin"]) {
				await mkdir(path.join(root, directory), { recursive: true })
			}
			await writeFile(path.join(root, "scripts/stage-backend.mjs"), 'import { writeFileSync } from "node:fs"; writeFileSync("staged", "yes")')
			await writeFile(path.join(root, "node_modules/typescript/bin/tsc"), `
const { appendFileSync, existsSync, writeFileSync } = require("node:fs")
appendFileSync("steps", process.argv.at(-1) + "\\n")
writeFileSync("compiler-pid", String(process.pid))
if (existsSync("fail")) process.exit(1)
process.on("SIGTERM", () => {})
const timer = setInterval(() => { if (existsSync("release")) { clearInterval(timer); process.exit(0) } }, 20)
`)
			await writeFile(path.join(root, "node_modules/vite/bin/vite.js"), 'require("node:fs").appendFileSync("steps", "bundle\\n")')
			await use({ root, launch: async (preview = true) => {
				const app = await playwright._electron.launch({
					args: [root, "--prepare", preview ? "--preview" : "--mock", "--ozone-platform=x11", "--force-device-scale-factor=1"],
					chromiumSandbox: true, cwd: root, timeout: 15_000,
					env: { ...process.env, ROBOZIUM_DESKTOP_TEST_DATA: path.join(root, "profile") },
				})
				const child = app.process()
				applications.push({ app, child })
				child.stdout?.on("data", chunk => logs.push(String(chunk)))
				child.stderr?.on("data", chunk => logs.push(String(chunk)))
				return app
			} })
		} finally {
			for (const { app, child } of applications) {
				try {
					if (child.exitCode === null && child.signalCode === null) await app.close()
				} finally {
					if (child.exitCode === null && child.signalCode === null) {
						const exit = once(child, "exit")
						child.kill("SIGKILL")
						await exit
					}
				}
			}
			await testInfo.attach("startup.log", { body: logs.join(""), contentType: "text/plain" })
			await rm(root, { recursive: true, force: true })
		}
	},
})

async function closeWindow(app: ElectronApplication) {
	const exit = once(app.process(), "exit")
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
	expect(await exit).toEqual([0, null])
}

test("the splash is visible during preparation and hands the same window to the HUD", async ({ startup }, testInfo) => {
	const app = await startup.launch()
	const page = await app.firstWindow()
	await expect(page.getByRole("status")).toHaveText("Building Robozium…")
	const windowId = await app.evaluate(({ BrowserWindow }) => {
		const window = BrowserWindow.getAllWindows()[0]
		if (!window.isVisible()) throw new Error("Splash must be visible before preparation completes")
		return window.id
	})
	await expect(page.getByRole("button", { name: "Start run" })).toHaveCount(0)
	await setNativeViewport(app, page, 640, 420, 1.25)
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth
		&& document.documentElement.scrollHeight <= innerHeight)).toBe(true)
	await testInfo.attach("splash.png", { body: await page.screenshot(), contentType: "image/png" })
	await writeFile(path.join(startup.root, "release"), "")
	const hud = await applicationPage(app)
	await expect(hud).toHaveURL(documentUrl)
	await expect(hud.getByRole("button", { name: "Start run", exact: true })).toBeVisible()
	await expect.poll(() => page.isClosed(), { timeout: 10_000 }).toBe(true)
	expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => window.id))).toEqual([windowId])
	expect(await readFile(path.join(startup.root, "steps"), "utf8")).toBe("tsconfig.json\nrenderer/tsconfig.json\nbundle\n")
	await expect(readFile(path.join(startup.root, "staged"))).rejects.toMatchObject({ code: "ENOENT" })
	// Preparation IPC is inaccessible to the application document after handoff.
	expect(await hud.evaluate(async () => {
		try { await window.roboziumStartup.retry(); return "allowed" }
		catch { return "rejected" }
	})).toBe("rejected")
})

test("preparation failure stays visible and Retry submits once before successful handoff", async ({ startup }) => {
	await writeFile(path.join(startup.root, "fail"), "")
	const app = await startup.launch()
	const page = await app.firstWindow()
	await expect(page.getByRole("alert")).toContainText("Startup preparation failed")
	await setNativeViewport(app, page, 640, 420, 1.25)
	expect(await page.getByRole("alert").evaluate(element => element.clientHeight >= element.scrollHeight)).toBe(true)
	await rm(path.join(startup.root, "fail"))
	await page.getByRole("button", { name: "Retry", exact: true }).evaluate(button => {
		(button as HTMLButtonElement).click(); (button as HTMLButtonElement).click()
	})
	await expect(page.getByRole("status")).toHaveText("Building Robozium…")
	await expect.poll(() => readFile(path.join(startup.root, "steps"), "utf8")).toBe("tsconfig.json\ntsconfig.json\n")
	await writeFile(path.join(startup.root, "release"), "")
	await expect((await applicationPage(app)).getByRole("button", { name: "Start run", exact: true })).toBeVisible()
	await expect.poll(() => page.isClosed()).toBe(true)
})

for (const reduced of [false, true]) {
	test(`the introduction settles into a loading A until preparation finishes; reduced motion=${reduced}`, async ({ startup }, testInfo) => {
		const app = await startup.launch()
		const splash = await app.firstWindow()
		if (reduced) await splash.emulateMedia({ reducedMotion: "reduce" })
		await expect(splash.locator(".startup")).toHaveAttribute("data-stage", "loading", { timeout: 10_000 })
		await expect(splash.locator(".startup__logo")).toHaveText("A")
		expect(await splash.locator(".startup__logo").evaluate(element => getComputedStyle(element).animationName))
			.toBe(reduced ? "none" : "working-pulse")
		await expect(splash.locator(".intro-character:not(.intro-character--shown)")).toHaveCount(0)
		expect(app.context().pages().some(page => page.url() === documentUrl)).toBe(false)
		await testInfo.attach("loading.png", { body: await splash.screenshot(), contentType: "image/png" })
		await writeFile(path.join(startup.root, "release"), "")
		await expect((await applicationPage(app)).getByRole("button", { name: "Start run", exact: true })).toBeVisible()
		await expect.poll(() => splash.isClosed()).toBe(true)
	})
}

test("closing during preparation kills the compiler without starting a mock backend", async ({ startup }) => {
	const app = await startup.launch(false)
	const page = await app.firstWindow()
	await expect(page.getByRole("status")).toHaveText("Building Robozium…")
	await expect.poll(() => readFile(path.join(startup.root, "compiler-pid"), "utf8")).toMatch(/^\d+$/)
	const pid = Number(await readFile(path.join(startup.root, "compiler-pid"), "utf8"))
	expect(await readFile(path.join(startup.root, "staged"), "utf8")).toBe("yes")
	await closeWindow(app)
	expect(() => process.kill(pid, 0)).toThrow()
	await expect(readFile(path.join(startup.root, "profile/backend-installation-id"))).rejects.toMatchObject({ code: "ENOENT" })
	expect(await readFile(path.join(startup.root, "steps"), "utf8")).toBe("tsconfig.json\n")
})

test("a duplicate launch cannot prepare files while the first launch is starting", async ({ startup }) => {
	const app = await startup.launch(false)
	await expect((await app.firstWindow()).getByRole("status")).toHaveText("Building Robozium…")
	await expect.poll(() => readFile(path.join(startup.root, "steps"), "utf8")).toBe("tsconfig.json\n")
	execFileSync(app.process().spawnfile, [startup.root, "--prepare", "--mock", "--ozone-platform=x11"], {
		cwd: startup.root, timeout: 15_000, stdio: "pipe",
		env: { ...process.env, ROBOZIUM_DESKTOP_TEST_DATA: path.join(startup.root, "profile") },
	})
	expect(await readFile(path.join(startup.root, "steps"), "utf8")).toBe("tsconfig.json\n")
	await closeWindow(app)
})
