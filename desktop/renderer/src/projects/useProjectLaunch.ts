// Copied from web/hooks/useProjectLaunch.ts at 5b06d82.
// Adapted: requests use the desktop client under one abortable lifetime with
// deadlines; a pending flag replaces the shared navigation lock; a launched run
// is handed to the caller instead of navigating; a locked backend is reported to
// the caller, which reads the secrets status again.
import { useEffect, useRef, useState } from "react"
import type { DesktopApiClient } from "../api/client"
import { withDeadline } from "../api/request"
import { getProjectSelection, listCapabilities, saveProjectSelection } from "../capabilities/capabilities-api"
import { resolveCapabilitySelection } from "../capabilities/capabilities"
import { createRun } from "../run/run-api"
import { showErrorToast } from "../feedback/notices"
import { isSecretsLocked, showSecretsLocked } from "../credentials/locked"
import type { LaunchDraft } from "../app/hud-navigation"
import { createProject } from "./projects-api"

export interface ProjectLaunch {
	launch: (draft: LaunchDraft) => Promise<boolean>
	pending: boolean
	/** The existing project being launched; a new project has no row yet. */
	opening: string | null
	/** Read synchronously, so a second click before the next render is refused. */
	isLaunching: () => boolean
}

/** Launch commands outlive the selector; failures remain visible after dismissal. */
export function useProjectLaunch(
	client: DesktopApiClient | null,
	onLaunched: (runId: string, project: string) => void,
	onProjectCreated: (name: string, project: string) => void,
	onSecretsLocked: () => void,
): ProjectLaunch {
	const active = useRef<AbortController | null>(null)
	const [pending, setPending] = useState(false)
	const [opening, setOpening] = useState<string | null>(null)
	useEffect(() => () => {
		active.current?.abort()
		active.current = null
		setPending(false)
		setOpening(null)
	}, [client])
	const launch = async ({ project, name, selection: draftSelection }: LaunchDraft): Promise<boolean> => {
		if (!client || active.current) return false
		const controller = new AbortController()
		active.current = controller
		setPending(true)
		setOpening(project)
		const request = <T,>(operation: (signal: AbortSignal) => Promise<T>) => withDeadline(controller.signal, operation)
		try {
			// Writes are never repeated automatically; a created project is reported
			// at once so that launching again reuses it instead of creating another.
			const slug = project ?? await request(signal => createProject(client, name.trim(), signal))
			if (project === null) onProjectCreated(name.trim(), slug)
			const selection = draftSelection ?? await request(async signal => {
				const [catalog, savedSelection] = await Promise.all([
					listCapabilities(client, signal), getProjectSelection(client, slug, signal),
				])
				return resolveCapabilitySelection(catalog, savedSelection)
			})
			await request(signal => saveProjectSelection(client, slug, selection, signal))
			const runId = await request(signal => createRun(client, slug, selection, signal))
			onLaunched(runId, slug)
			return true
		} catch (error) {
			if (controller.signal.aborted) return false
			if (isSecretsLocked(error)) {
				showSecretsLocked("Unlock secrets before starting a run.")
				onSecretsLocked()
				return false
			}
			showErrorToast({
				title: "Launch failed",
				message: error instanceof Error ? error.message : "Unable to launch project. Try again.",
			})
			return false
		} finally {
			if (active.current === controller) {
				active.current = null
				setPending(false)
				setOpening(null)
			}
		}
	}
	return { launch, pending, opening, isLaunching: () => active.current !== null }
}
