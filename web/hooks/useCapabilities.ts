"use client"

import { useEffect, useState } from "react"
import { AgentApiError, getProjectCapabilities, listCapabilities } from "@/lib/robozium/client"
import { resolveCapabilitySelection } from "@/lib/robozium/capabilities"
import type { CapabilitySelection, CapabilityView } from "@/lib/robozium/wire"

export function useCapabilities(project: string | null) {
	const [loaded, setLoaded] = useState<{
		project: string | null
		catalog: CapabilityView[]
		selection: CapabilitySelection
	} | null>(null)
	const [error, setError] = useState<{ project: string | null; message: string } | null>(null)
	const [attempt, setAttempt] = useState(0)
	useEffect(() => {
		const controller = new AbortController()
		void Promise.all([
			listCapabilities({ signal: controller.signal }),
			project === null ? null : getProjectCapabilities(project, { signal: controller.signal }),
		]).then(
			([catalog, saved]) => {
				if (!controller.signal.aborted) {
					setError(null)
					setLoaded({ project, catalog, selection: resolveCapabilitySelection(catalog, saved) })
				}
			},
			(error: unknown) => {
				if (!controller.signal.aborted) {
					setError({ project, message: error instanceof AgentApiError ? error.message : "Could not load capabilities." })
				}
			},
		)
		return () => controller.abort()
	}, [attempt, project])
	return {
		catalog: loaded?.project === project ? loaded.catalog : null,
		selection: loaded?.project === project ? loaded.selection : null,
		error: error?.project === project ? error.message : null,
		retry: () => {
			setError(null)
			setAttempt((value) => value + 1)
		},
	}
}
