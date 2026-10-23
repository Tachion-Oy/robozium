import { expect, test } from "@playwright/test"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { desktopRoot } from "./native"

test("a failed start explains itself in an error window, then exits", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "robozium-startup-error-"))
	try {
		const profile = path.join(directory, "profile")
		await mkdir(profile)
		// An identity file that names no installation stops the live backend from being created.
		await writeFile(path.join(profile, "backend-installation-id"), "not-an-id\n")
		const shown = path.join(directory, "error-box.json")
		// Record the error box instead of showing a native dialog nobody can close.
		// A preload replaces it once the main script has loaded, long before startup can
		// fail; the electron module is not available to the preload itself yet.
		const stub = path.join(directory, "record-error-box.cjs")
		await writeFile(stub, `setImmediate(() => { require("electron").dialog.showErrorBox = (title, content) =>
	require("node:fs").writeFileSync(${JSON.stringify(shown)}, JSON.stringify({ title, content })) })\n`)
		// Playwright cannot attach to an app that exits during startup; run the binary itself.
		const electron = (await import("electron")).default as unknown as string
		const child = spawn(electron, [desktopRoot, "--ozone-platform=x11", "--force-device-scale-factor=1"], {
			cwd: directory,
			env: { ...process.env, ROBOZIUM_DESKTOP_TEST_DATA: profile, NODE_OPTIONS: `--require ${stub}` },
			stdio: "ignore",
		})
		const [code] = await once(child, "exit")
		expect(code).toBe(1)
		expect(JSON.parse(await readFile(shown, "utf8"))).toEqual({
			title: "Robozium could not start",
			content: "Desktop backend ownership does not match its saved installation identifier.",
		})
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})
