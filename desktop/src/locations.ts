import path from "node:path"
import { locations } from "./backend-layout.ts"

interface LocationInputs {
	/** Electron's `app.isPackaged`. */
	packaged: boolean
	/** Directory of the compiled main process (`import.meta.dirname`). */
	appDirectory: string
	/** Electron's `process.resourcesPath`; plain files packaged beside the app archive. */
	resourcesPath: string
	/** Electron's default `userData` directory, such as `~/.config/Robozium`. */
	userData: string
	/** The user's home directory, which a `~/` location starts from. */
	home: string
	mode: "live" | "mock"
	/** `ROBOZIUM_DESKTOP_TEST_DATA`: an explicit profile, as tests and shared dev profiles use. */
	profileOverride?: string
}

/** Where the user's chosen hub folder is recorded, and the folder used until one is chosen. */
export interface HubFolderLocation {
	file: string
	defaultFolder: string
	/** Where earlier installed versions kept the hub, inside app data; its projects are reported, never used. */
	earlierFolder: string | null
}

export interface DesktopLocations {
	/** Settings, the backend runtime and its data. */
	profile: string
	/** Staged backend sources that the container engine builds the image from. */
	source: string
	/** The compiled sandboxed preload script, beside the main process. */
	preload: string
	/** The built interface the window loads, beside the main process. */
	renderer: string
	/** Where a live launch records its chosen hub folder; null for mock mode. */
	hubFolder: HubFolderLocation | null
}

/** Expand a leading `~/` from the user's home directory. */
export function expandHome(location: string, home: string): string {
	return location.startsWith("~/") ? path.join(home, location.slice(2)) : location
}

/**
 * An installed app keeps its profile in the user's config directory and reads
 * the backend files the container engine needs from plain packaged resources. A checkout keeps
 * a profile of its own next to it, so worktrees stay isolated. Every live launch
 * can choose its hub folder. An installed app on its own profile starts with
 * `~/Robozium-Hub`; checkouts and test profiles start with a throwaway hub in
 * their runtime. Mock mode keeps that throwaway hub, since its fake projects
 * must never reach a real one.
 */
export function desktopLocations(inputs: LocationInputs): DesktopLocations {
	const { packaged, appDirectory, resourcesPath, userData, home, mode, profileOverride } = inputs
	const profile = path.resolve(profileOverride ?? (packaged ? userData : path.join(appDirectory, locations.checkoutProfile)))
	const backend = packaged ? path.join(resourcesPath, locations.installedBackend) : path.join(appDirectory, locations.checkoutBackend)
	const installed = packaged && profileOverride === undefined
	const runtimeHub = path.join(profile, mode, locations.isolatedHub)
	return {
		profile,
		source: path.join(backend, packaged ? locations.installedSource : locations.checkoutSource),
		preload: path.join(appDirectory, locations.preload),
		renderer: path.join(appDirectory, locations.renderer),
		hubFolder: mode === "live"
			? {
				file: path.join(profile, locations.hubFolder),
				defaultFolder: installed ? expandHome(locations.defaultHub, home) : runtimeHub,
				earlierFolder: installed ? runtimeHub : null,
			}
			: null,
	}
}
