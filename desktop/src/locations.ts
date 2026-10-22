import path from "node:path"

interface LocationInputs {
	/** Electron's `app.isPackaged`. */
	packaged: boolean
	/** Directory of the compiled main process (`__dirname`). */
	appDirectory: string
	/** Electron's `process.resourcesPath`; plain files packaged beside the app archive. */
	resourcesPath: string
	/** Electron's default `userData` directory, such as `~/.config/Robozium`. */
	userData: string
	preview: boolean
	/** `ROBOZIUM_DESKTOP_TEST_DATA`: an explicit profile, as tests and shared dev profiles use. */
	profileOverride?: string
}

export interface DesktopLocations {
	/** Settings, the backend runtime and its data. */
	profile: string
	/** Staged backend sources that Compose builds the image from. */
	source: string
	/** Compose file; it extends `src/backend-layout.json` beside it. */
	compose: string
}

/**
 * An installed app keeps its profile in the user's config directory and reads
 * the backend files Docker needs from plain packaged resources. A checkout keeps
 * a profile of its own next to it, so worktrees stay isolated.
 */
export function desktopLocations(inputs: LocationInputs): DesktopLocations {
	const { packaged, appDirectory, resourcesPath, userData, preview, profileOverride } = inputs
	const defaultProfile = packaged
		? (preview ? path.join(userData, "preview") : userData)
		: path.join(appDirectory, "../../.artifacts/desktop", preview ? "scaffold" : "data")
	const backend = packaged ? path.join(resourcesPath, "backend") : path.join(appDirectory, "..")
	return {
		profile: path.resolve(profileOverride ?? defaultProfile),
		source: packaged ? path.join(backend, "stage") : path.join(backend, ".stage/backend"),
		compose: path.join(backend, "compose.yaml"),
	}
}
