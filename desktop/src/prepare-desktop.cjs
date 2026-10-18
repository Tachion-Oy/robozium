const { spawn, spawnSync } = require("node:child_process")
const process = require("node:process")
const path = require("node:path")
const { setTimeout, clearTimeout } = require("node:timers")

/** Run a development tool directly, without a shell or an intermediate npm process.
 * @param {string} root
 * @param {string[]} args
 * @param {AbortSignal} signal
 */
function runTool(root, args, signal) {
	return new Promise((resolve, reject) => {
		if (signal.aborted) { reject(signal.reason); return }
		const child = spawn(process.execPath, args, {
			cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
			detached: process.platform !== "win32", shell: false, stdio: ["ignore", "pipe", "pipe"],
		})
		child.stdout.pipe(process.stdout)
		child.stderr.pipe(process.stderr)
		/** @type {Error | undefined} */
		let failure
		/** @type {ReturnType<typeof setTimeout> | undefined} */
		let forceKill
		/** @param {NodeJS.Signals} value */
		const kill = value => {
			if (!child.pid) return
			try {
				if (process.platform === "win32") {
					spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { timeout: 5000, windowsHide: true })
				} else process.kill(-child.pid, value)
			} catch { /* The process group already exited. */ }
		}
		/** @param {string} message */
		const stop = message => {
			if (failure) return
			failure = new Error(message)
			kill("SIGTERM")
			forceKill = setTimeout(() => kill("SIGKILL"), 2000)
		}
		const abort = () => stop("Startup preparation cancelled.")
		const deadline = setTimeout(() => stop("Startup preparation timed out. Check the terminal and retry."), 120_000)
		signal.addEventListener("abort", abort, { once: true })
		child.on("error", error => { failure = error })
		child.on("close", code => {
			clearTimeout(deadline)
			clearTimeout(forceKill)
			signal.removeEventListener("abort", abort)
			if (failure) reject(failure)
			else if (code !== 0) reject(new Error("Startup preparation failed. Check the terminal, fix the error and retry."))
			else resolve(undefined)
		})
		if (signal.aborted) abort()
	})
}

/** Keep preparation behind the visible splash; packaged/prebuilt launches skip it.
 * @param {string} root
 * @param {boolean} includeBackend
 * @param {AbortSignal} signal
 * @param {(message: string) => void} report
 */
async function prepareDesktop(root, includeBackend, signal, report) {
	const steps = [
		...includeBackend ? [{ message: "Preparing backend files…", args: ["scripts/stage-backend.mjs"] }] : [],
		{ message: "Building Robozium…", args: ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"] },
		{ message: "Checking the interface…", args: ["node_modules/typescript/bin/tsc", "-p", "renderer/tsconfig.json"] },
		{ message: "Preparing the interface…", args: ["node_modules/vite/bin/vite.js", "build"] },
	]
	for (const step of steps) {
		signal.throwIfAborted()
		report(step.message)
		await runTool(root, [path.join(root, step.args[0]), ...step.args.slice(1)], signal)
	}
	signal.throwIfAborted()
}

module.exports = { prepareDesktop }
