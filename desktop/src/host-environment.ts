import { appendFileSync } from "node:fs"
import type { CommandOptions, runCommand } from "./host-command.ts"

interface HostEnvironmentOptions {
	uv: string
	/** Staged backend sources; their `pyproject.toml` and `uv.lock` pin the host programs. */
	source: string
	directory: string
	log: string
	env: NodeJS.ProcessEnv
	signal: AbortSignal
	run: typeof runCommand
}

/** The variables a host program receives: the user's own, without the backend's controlled names. */
export function hostProcessEnvironment(directory: string): NodeJS.ProcessEnv {
	return {
		...Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(COMPOSE_|ROBOZIUM_|ROBOZ_)/.test(name))),
		UV_PROJECT_ENVIRONMENT: directory,
	}
}

/** Sync the one Python environment every host service runs from with the backend's locked `host` group.
 * An environment that already matches the lock is left as it is, without network access.
 */
export async function prepareHostEnvironment(options: HostEnvironmentOptions): Promise<void> {
	const command: CommandOptions = {
		cwd: options.source,
		env: options.env,
		signal: options.signal,
		timeout: 600_000,
		log: output => appendFileSync(options.log, output, { mode: 0o600 }),
	}
	try {
		await options.run(options.uv, [
			"sync", "--project", options.source, "--locked", "--only-group", "host", "--no-install-project",
		], command)
	} catch (error) {
		options.signal.throwIfAborted()
		throw new Error(`Could not prepare host services. See ${options.log}.`, { cause: error })
	}
}
