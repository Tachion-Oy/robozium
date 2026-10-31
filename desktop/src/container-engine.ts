import { readFileSync } from "node:fs"
import { parseEnv } from "node:util"
import definition from "./backend-layout.json" with { type: "json" }
import type { BackendLayout, BackendMount } from "./backend-layout.ts"

/**
 * The backend container as the desktop needs it, independent of the engine and
 * platform that run it. An engine decides how to meet each need: a Linux engine
 * shares the host's network, while one running containers in a virtual machine
 * would publish the port on the host's loopback interface instead.
 */
export interface BackendContainer {
	name: string
	image: string
	/** Ownership labels; the controller recognises its own containers by these. */
	labels: Record<string, string>
	mounts: BackendMount[]
	/** The backend process's variables; an engine never puts their values on a command line. */
	environment: Record<string, string>
	/** A private file an engine may write the variables to while it starts the container; it must remove it after. */
	environmentFile: string
	/** The command, with `{address}` left for the engine to fill with the address the API listens on. */
	command: string[]
	/** The API listens on this port of the host's loopback interface only. */
	port: number
	stopTimeoutSeconds: number
}

export interface ImageBuild {
	image: string
	/** The staged sources and their Dockerfile. */
	context: string
	target: string
	buildArguments: Record<string, string>
}

/** What the controller reads back from a container to verify that it owns it. */
export interface ContainerInspection {
	labels: Record<string, string>
	running: boolean
	mounts: BackendMount[]
}

/** Each call's cancellation, deadline and diagnostics log. */
export interface EngineCall {
	signal: AbortSignal
	timeout?: number
	log?: (text: string) => void
}

/** The operations the backend controller needs from a container engine. */
export interface ContainerEngine {
	/** The engine's name for messages, such as "Podman". */
	readonly name: string
	/** Check that the engine is installed and safe to use; throws an actionable error otherwise. */
	prepare(call: EngineCall): Promise<void>
	/** A label of a local image, or undefined when the image does not exist. */
	imageLabel(image: string, label: string, call: EngineCall): Promise<string | undefined>
	build(build: ImageBuild, call: EngineCall): Promise<void>
	/** IDs of every container, running or not, that carries this label value. */
	list(label: string, value: string, call: EngineCall): Promise<string[]>
	inspect(id: string, call: EngineCall): Promise<ContainerInspection>
	/** Create and start the container in the background. */
	run(container: BackendContainer, call: EngineCall): Promise<void>
	restart(id: string, timeoutSeconds: number, call: EngineCall): Promise<void>
	stop(ids: string[], timeoutSeconds: number, call: EngineCall): Promise<void>
	remove(ids: string[], call: EngineCall): Promise<void>
	logs(id: string, lines: number, call: EngineCall): Promise<string>
}

const variableName = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * The backend's variables: the layout's environment files in order, each
 * overriding the one before, then the layout's own values and the selected
 * mode and port, which no file can override. Missing files are skipped.
 */
export function backendEnvironment(layout: BackendLayout, mode: "live" | "mock", port: number): Record<string, string> {
	const environment: Record<string, string> = {}
	for (const file of layout.environmentFiles) {
		let content: string
		try {
			content = readFileSync(file, "utf8")
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue
			throw new Error(`Could not read ${file}. Check its permissions.`, { cause: error })
		}
		for (const [name, value] of Object.entries(parseEnv(content))) {
			if (value !== undefined) environment[name] = value
		}
	}
	Object.assign(environment, definition.services.api.environment, {
		ROBOZIUM_MODE: mode,
		ROBOZIUM_DESKTOP_API_PORT: String(port),
	})
	for (const [name, value] of Object.entries(environment)) {
		if (!variableName.test(name)) throw new Error(`Environment variable name ${JSON.stringify(name)} is invalid. Correct it in Environment.`)
		if (/[\r\n\0]/.test(value)) throw new Error(`Environment variable ${name} spans several lines, which the backend cannot receive. Correct it in Environment.`)
	}
	return environment
}

/** The backend command for this mode and port; the engine fills in the listening address. */
export function backendCommand(mode: "live" | "mock", port: number): string[] {
	return definition.services.api.command.map(part => part.replace("{mode}", mode).replace("{port}", String(port)))
}

export const backendStopTimeoutSeconds = definition.services.api.stop_grace_period
export const backendBuildTarget = definition.services.api.build.target
