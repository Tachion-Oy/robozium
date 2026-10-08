"use client"

import { useRouter } from "next/navigation"
import { AgentApiError, createProject, createRun, getProjectCapabilitySelection, listCapabilities, saveProjectCapabilitySelection } from "@/lib/robozium/client"
import { resolveCapabilitySelection } from "@/lib/robozium/capabilities"
import type { LaunchDraft } from "@/lib/robozium/hud-navigation"
import { beginHudNavigation, hudVisibilityStore } from "@/lib/robozium/hud-visibility"
import { showErrorToast } from "@/app/components/feedback/ErrorToast"

/** Launch commands outlive the selector; failures remain visible after dismissal. */
export function useProjectLaunch(
	onLaunched: () => void,
	onProjectCreated: (name: string, project: string) => void,
) {
	const router = useRouter()
	return async ({ project, name, selection: draftSelection }: LaunchDraft): Promise<boolean> => {
		if (!beginHudNavigation()) return false
		try {
			const slug = project ?? (await createProject({ name: name.trim() })).slug
			if (project === null) onProjectCreated(name.trim(), slug)
			let launchSelection = draftSelection
			if (launchSelection === null) {
				const [catalog, savedSelection] = await Promise.all([listCapabilities(), getProjectCapabilitySelection(slug)])
				launchSelection = resolveCapabilitySelection(catalog, savedSelection)
			}
			await saveProjectCapabilitySelection(slug, launchSelection)
			const { run_id } = await createRun({ project: slug, capabilities: launchSelection })
			onLaunched()
			router.push(`/?runId=${encodeURIComponent(run_id)}`)
			return true
		} catch (error) {
			hudVisibilityStore.setState({ navigationPending: false })
			const locked = error instanceof AgentApiError && error.status === 423
			showErrorToast({
				title: locked ? "API keys locked" : "Launch failed",
				message: locked
					? "Unlock API keys before starting a run."
					: error instanceof AgentApiError
						? error.message
						: "Unable to launch project. Try again.",
				...(locked ? { detail: "Open the API keys locked menu and enter your password." } : {}),
			})
			return false
		}
	}
}
