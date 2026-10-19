// Copied from web/hooks/useProjectLaunch.ts at 5b06d82.
// Adapted: requests use the desktop client under one abortable lifetime with
// deadlines; a pending flag replaces the shared navigation lock; a launched run
// is handed to the caller instead of navigating.
import { useEffect, useRef, useState } from "react"
import { ApiError, type DesktopApiClient } from "../api/client"
import { withDeadline } from "../api/request"
import { getProjectSelection, listCapabilities, saveProjectSelection, type CapabilitySelection } from "../capabilities/capabilities-api"
import { resolveCapabilitySelection } from "../capabilities/capabilities"
import { createRun } from "../run/run-api"
import { showErrorToast } from "../feedback/notices"
import { createProject } from "./projects-api"

/** Adapted from web/lib/robozium/hud-navigation.ts; the overview's selector edits it. */
export interface LaunchDraft {
	project: string | null
	name: string
	/** Null restores saved choices; an object is the user's current draft. */
	selection: CapabilitySelection | null
}

export interface ProjectLaunch {
	launch: (draft: LaunchDraft) => Promise<boolean>
	pending: boolean
}

/** Launch commands outlive the selector; failures remain visible after dismissal. */
export function useProjectLaunch(
	client: DesktopApiClient | null,
	onLaunched: (runId: string, project: string) => void,
	onProjectCreated: (name: string, project: string) => void,
): ProjectLaunch {
	const active = useRef<AbortController | null>(null)
	const [pending, setPending] = useState(false)
	useEffect(() => () => {
		active.current?.abort()
		active.current = null
		setPending(false)
	}, [client])
	const launch = async ({ project, name, selection: draftSelection }: LaunchDraft): Promise<boolean> => {
		if (!client || active.current) return false
		const controller = new AbortController()
		active.current = controller
		setPending(true)
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
			const locked = error instanceof ApiError && error.status === 423
			showErrorToast({
				title: locked ? "Secrets locked" : "Launch failed",
				message: locked
					? "Unlock secrets before starting a run."
					: error instanceof Error
						? error.message
						: "Unable to launch project. Try again.",
				...(locked ? { detail: "Open the Secrets locked menu and enter your password." } : {}),
			})
			return false
		} finally {
			if (active.current === controller) {
				active.current = null
				setPending(false)
			}
		}
	}
	return { launch, pending }
}
