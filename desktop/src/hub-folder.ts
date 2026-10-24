import { accessSync, constants, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { isInside, locations } from "./backend-layout.cjs"
import type { HubFolderLocation } from "./locations"

/** A hub folder that cannot be used; the user must reconnect it or choose another. */
export class HubFolderError extends Error {}

/** A folder from the picker, checked and ready to record. */
export interface HubFolderChoice {
	folder: string
	/** Non-empty but without a hub's projects folder: picking a parent by mistake would scatter hub files into it. */
	needsConfirmation: boolean
}

/** Refuse anything but an existing, writable directory outside the app's data folder. */
function usableFolder(folder: string, profile: string): string {
	let resolved: string
	try {
		if (!statSync(folder).isDirectory()) throw new HubFolderError(`Hub folder ${folder} is not a folder. Choose another folder.`)
		accessSync(folder, constants.R_OK | constants.W_OK)
		resolved = realpathSync(folder)
	} catch (error) {
		if (error instanceof HubFolderError) throw error
		const code = (error as NodeJS.ErrnoException).code
		throw new HubFolderError(code === "ENOENT"
			? `Hub folder ${folder} is missing. Reconnect it or choose another folder.`
			: `Hub folder ${folder} cannot be read and written. Fix its permissions or choose another folder.`)
	}
	const appData = realpathSync(profile)
	if (isInside(resolved, appData) || isInside(appData, resolved)) {
		throw new HubFolderError(`Hub folder ${folder} overlaps the app's data folder ${appData}. Choose another folder.`)
	}
	return resolved
}

/**
 * The hub folder for this launch. With nothing recorded, the default is used and
 * created if absent. A chosen folder is never replaced or recreated: when it is
 * missing or the record is unreadable, startup stops so no data is hidden.
 */
export function resolveHubFolder(location: HubFolderLocation, profile: string): string {
	let recorded: string
	try {
		recorded = readFileSync(location.file, "utf8").trim()
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw new HubFolderError(`The hub folder setting ${location.file} cannot be read. Choose the hub folder again.`)
		}
		if (location.earlierFolder && hasEntries(path.join(location.earlierFolder, locations.hubProjects))) {
			throw new HubFolderError(`Projects from an earlier version are in ${location.earlierFolder}, inside the app's data. `
				+ `Move that folder's contents into a hub folder such as ${location.defaultFolder}, then choose it.`)
		}
		// The default comes from the layout; a checkout's throwaway default lies inside its own data.
		mkdirSync(location.defaultFolder, { recursive: true, mode: 0o700 })
		return location.defaultFolder
	}
	if (!path.isAbsolute(recorded)) {
		throw new HubFolderError(`The hub folder setting ${location.file} does not hold an absolute folder. Choose the hub folder again.`)
	}
	return usableFolder(recorded, profile)
}

/** The recorded folder, or null when none is recorded or the record cannot be read. */
export function recordedHubFolder(location: HubFolderLocation): string | null {
	try {
		const recorded = readFileSync(location.file, "utf8").trim()
		return path.isAbsolute(recorded) ? recorded : null
	} catch {
		return null
	}
}

function hasEntries(folder: string): boolean {
	try {
		return readdirSync(folder).length > 0
	} catch {
		return false
	}
}

/** Check a folder from the picker; temporary folders are refused because they are cleared on reboot. */
export function checkHubFolderChoice(folder: string, profile: string, temporary: string): HubFolderChoice {
	if (!path.isAbsolute(folder)) throw new HubFolderError("Choose an absolute folder.")
	const resolved = usableFolder(folder, profile)
	if (isInside(resolved, realpathSync(temporary))) {
		throw new HubFolderError(`Hub folder ${folder} is a temporary folder that is cleared on restart. Choose another folder.`)
	}
	const entries = readdirSync(resolved)
	return { folder: resolved, needsConfirmation: entries.length > 0 && !entries.includes(locations.hubProjects) }
}

/** Record the hub folder; `hub-folder` is its only home, and only Electron writes it. */
export function saveHubFolder(location: HubFolderLocation, folder: string): void {
	writeFileSync(`${location.file}.tmp`, folder + "\n", { mode: 0o600 })
	renameSync(`${location.file}.tmp`, location.file)
}
