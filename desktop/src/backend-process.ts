import { spawn } from "node:child_process"
import { accessSync, constants } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

export function findDocker(): string | undefined {
	for (const directory of [...(process.env.PATH ?? "").split(path.delimiter), "/usr/bin", "/usr/local/bin", path.join(homedir(), ".local/bin")]) {
		if (!directory) continue
		const executable = path.resolve(directory, "docker")
		try { accessSync(executable, constants.X_OK); return executable } catch { /* Try the next location. */ }
	}
}

export interface CommandOptions {
	cwd: string
	env: NodeJS.ProcessEnv
	signal: AbortSignal
	timeout?: number
	log?: (text: string) => void
}

/** Bound command lifetime and output; terminate the Compose client process group on cancellation. */
export function runCommand(executable: string, args: string[], options: CommandOptions): Promise<string> {
	return new Promise((resolve, reject) => {
		if (options.signal.aborted) { reject(new Error("Backend startup cancelled.")); return }
		const child = spawn(executable, args, { cwd: options.cwd, env: options.env, shell: false,
			detached: process.platform === "linux", stdio: ["ignore", "pipe", "pipe"] })
		child.stdout.setEncoding("utf8")
		child.stderr.setEncoding("utf8")
		let output = "", failure: Error | undefined, killTimer: NodeJS.Timeout | undefined
		const kill = (signal: NodeJS.Signals) => {
			try {
				if (process.platform === "linux" && child.pid) process.kill(-child.pid, signal)
				else child.kill(signal)
			} catch { /* The process already exited. */ }
		}
		const terminate = (message: string) => {
			if (failure) return
			failure = new Error(message)
			kill("SIGTERM")
			killTimer = setTimeout(() => kill("SIGKILL"), 2000)
		}
		const abort = () => terminate("Backend startup cancelled.")
		const timer = setTimeout(() => terminate("Docker command timed out. Check Docker and retry."), options.timeout ?? 120_000)
		options.signal.addEventListener("abort", abort, { once: true })
		const log = (chunk: string) => {
			try { options.log?.(chunk) }
			catch { terminate("Could not write the desktop Docker log. Check available disk space and permissions.") }
		}
		child.stdout.on("data", chunk => { output = (output + chunk).slice(-1024 * 1024); log(chunk) })
		child.stderr.on("data", log)
		child.on("error", () => { failure = new Error("Could not execute Docker. Check its installation and permissions.") })
		child.on("close", code => {
			clearTimeout(timer)
			clearTimeout(killTimer)
			options.signal.removeEventListener("abort", abort)
			if (failure || code !== 0) reject(failure ?? new Error("Docker command failed. Check the desktop Docker log and retry."))
			else resolve(output)
		})
		if (options.signal.aborted) abort()
	})
}
