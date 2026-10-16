import { spawn } from "node:child_process"
import { accessSync, constants } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

const MAX_CAPTURED_OUTPUT_LENGTH = 1024 * 1024

export function findDocker(): string | undefined {
	const searchDirectories = [
		...(process.env.PATH ?? "").split(path.delimiter),
		"/usr/bin",
		"/usr/local/bin",
		path.join(homedir(), ".local/bin"),
	]

	for (const directory of searchDirectories) {
		if (!directory) {
			continue
		}

		const executable = path.resolve(directory, "docker")
		try {
			accessSync(executable, constants.X_OK)
			return executable
		} catch {
			// Try the next location.
		}
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
		if (options.signal.aborted) {
			reject(new Error("Backend startup cancelled."))
			return
		}

		const child = spawn(executable, args, {
			cwd: options.cwd,
			env: options.env,
			shell: false,
			detached: process.platform === "linux",
			stdio: ["ignore", "pipe", "pipe"],
		})
		child.stdout.setEncoding("utf8")
		child.stderr.setEncoding("utf8")

		let output = ""
		let failure: Error | undefined
		let forceKillTimer: NodeJS.Timeout | undefined

		const sendSignal = (signal: NodeJS.Signals) => {
			try {
				if (process.platform === "linux" && child.pid) {
					// A negative PID signals the whole group, including Compose descendants.
					process.kill(-child.pid, signal)
				} else {
					child.kill(signal)
				}
			} catch {
				// The process already exited.
			}
		}

		const terminate = (message: string) => {
			if (failure) {
				return
			}

			failure = new Error(message)
			sendSignal("SIGTERM")
			forceKillTimer = setTimeout(() => sendSignal("SIGKILL"), 2000)
		}

		const handleAbort = () => terminate("Backend startup cancelled.")
		const commandTimer = setTimeout(() => {
			terminate("Docker command timed out. Check Docker and retry.")
		}, options.timeout ?? 120_000)
		options.signal.addEventListener("abort", handleAbort, { once: true })

		const writeLog = (chunk: string) => {
			try {
				options.log?.(chunk)
			} catch {
				terminate("Could not write the desktop Docker log. Check available disk space and permissions.")
			}
		}

		child.stdout.on("data", chunk => {
			output = (output + chunk).slice(-MAX_CAPTURED_OUTPUT_LENGTH)
			writeLog(chunk)
		})
		child.stderr.on("data", writeLog)
		child.on("error", () => {
			failure = new Error("Could not execute Docker. Check its installation and permissions.")
		})
		child.on("close", code => {
			clearTimeout(commandTimer)
			clearTimeout(forceKillTimer)
			options.signal.removeEventListener("abort", handleAbort)

			if (failure) {
				reject(failure)
			} else if (code !== 0) {
				reject(new Error("Docker command failed. Check the desktop Docker log and retry."))
			} else {
				resolve(output)
			}
		})

		if (options.signal.aborted) {
			handleAbort()
		}
	})
}
