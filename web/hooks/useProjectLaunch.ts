"use client"

import { useRouter } from "next/navigation"
import { AgentApiError, createProject, createRun, getProjectCapabilities, listCapabilities, saveProjectCapabilities } from "@/lib/robozium/client"
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
	return async ({ project, name, capabilities }: LaunchDraft): Promise<boolean> => {
		if (!beginHudNavigation()) return false
		try {
			const slug = project ?? (await createProject({ name: name.trim() })).slug
			if (project === null) onProjectCreated(name.trim(), slug)
			let selection = capabilities
			if (selection === null) {
				const [catalog, saved] = await Promise.all([listCapabilities(), getProjectCapabilities(slug)])
				selection = resolveCapabilitySelection(catalog, saved)
			}
			await saveProjectCapabilities(slug, selection)
			const { run_id } = await createRun({ project: slug, capabilities: selection })
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
