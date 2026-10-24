// Development launches build behind the splash; adapted from #101's prepare-desktop.cjs.
import { spawn, spawnSync } from "node:child_process"
import path from "node:path"

const STEP_TIMEOUT_MS = 180_000

/** Run a development tool with Electron's own Node, without a shell or an npm process. */
function runTool(root: string, args: string[], signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) { reject(signal.reason); return }
		const child = spawn(process.execPath, args, {
			cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
			detached: process.platform !== "win32", shell: false, stdio: ["ignore", "inherit", "inherit"],
		})
		let failure: Error | undefined
		let forceKill: NodeJS.Timeout | undefined
		const kill = (value: NodeJS.Signals) => {
			if (!child.pid) return
			try {
				if (process.platform === "win32") {
					spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { timeout: 5000, windowsHide: true })
				} else process.kill(-child.pid, value)
			} catch { /* The process group already exited. */ }
		}
		const stop = (message: string) => {
			if (failure) return
			failure = new Error(message)
			kill("SIGTERM")
			forceKill = setTimeout(() => kill("SIGKILL"), 2000)
		}
		const abort = () => stop("Preparation cancelled.")
		const deadline = setTimeout(() => stop("Preparation timed out. Check the terminal and retry."), STEP_TIMEOUT_MS)
		signal.addEventListener("abort", abort, { once: true })
		child.on("error", error => { failure = error })
		child.on("close", code => {
			clearTimeout(deadline)
			clearTimeout(forceKill)
			signal.removeEventListener("abort", abort)
			if (failure) reject(failure)
			else if (code !== 0) reject(new Error("Preparation failed. Check the terminal, fix the error and retry."))
			else resolve()
		})
	})
}

/**
 * Stage the backend and build the app, reporting each step. Type checking is left
 * to `npm run typecheck` and CI, so the window opens without waiting for it.
 */
export async function prepareDesktop(root: string, includeBackend: boolean, signal: AbortSignal, report: (step: string) => void): Promise<void> {
	const tsc = "node_modules/typescript/bin/tsc"
	const steps = [
		...includeBackend ? [{ step: "Preparing backend files…", args: ["scripts/stage-backend.ts"] }] : [],
		{ step: "Building Robozium…", args: [tsc, "-p", "tsconfig.json"] },
		{ step: "Building Robozium…", args: [tsc, "-p", "tsconfig.preload.json"] },
		{ step: "Preparing the interface…", args: ["node_modules/vite/bin/vite.js", "build"] },
	]
	for (const { step, args } of steps) {
		signal.throwIfAborted()
		report(step)
		await runTool(root, [path.join(root, args[0]), ...args.slice(1)], signal)
	}
}
