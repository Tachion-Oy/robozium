import type { ContainerEngine } from "./container-engine.ts"
import { PodmanEngine } from "./podman-engine.ts"

const OS_NAMES: Partial<Record<NodeJS.Platform, string>> = { darwin: "macOS", win32: "Windows" }

/** The container engine for this operating system; the only place an engine implementation is chosen. */
export function platformEngine(platform: NodeJS.Platform = process.platform): ContainerEngine {
	if (platform === "linux") return new PodmanEngine()
	return unsupportedEngine(OS_NAMES[platform] ?? platform)
}

/** Fails at the first step, so the startup screen explains instead of the app crashing. */
function unsupportedEngine(os: string): ContainerEngine {
	const unsupported = (): never => {
		throw new Error(`Robozium does not support ${os} yet.`)
	}
	return {
		name: "the container engine",
		prepare: async () => unsupported(),
		imageLabel: async () => unsupported(),
		build: async () => unsupported(),
		list: async () => unsupported(),
		inspect: async () => unsupported(),
		run: async () => unsupported(),
		restart: async () => unsupported(),
		stop: async () => unsupported(),
		remove: async () => unsupported(),
		logs: async () => unsupported(),
	}
}
