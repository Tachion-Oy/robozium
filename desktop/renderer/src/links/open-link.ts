// Open agent links through the desktop bridge; main validates every target.
import { bridgeErrorMessage } from "../feedback/bridge-error"
import { showErrorToast } from "../feedback/notices"

async function report(open: () => Promise<void>, target = "link") {
	try {
		await open()
	} catch (error) {
		showErrorToast({ title: `Could not open ${target}`, message: `The ${target} could not be opened.`, detail: bridgeErrorMessage(error) })
	}
}

/** Open an http(s) link in the default browser. */
export function openExternalLink(url: string): void {
	void report(() => window.robozium.openExternal(url))
}

/** Open a project's folder in the file manager. */
export function openProjectFolder(project: string): void {
	void report(() => window.robozium.openProjectFolder(project), "project folder")
}

/** Show the onboarding guide's markdown file in the file manager. */
export function showOnboardingFile(): void {
	void report(() => window.robozium.showOnboardingFile(), "onboarding file")
}

/** Open a hub-relative file or folder with its default application. */
export function openHubFile(path: string): void {
	void report(() => window.robozium.openHubFile(path))
}
