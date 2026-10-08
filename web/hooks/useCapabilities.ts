"use client"

import { useEffect, useState } from "react"
import { AgentApiError, getProjectCapabilitySelection, listCapabilities } from "@/lib/robozium/client"
import { resolveCapabilitySelection } from "@/lib/robozium/capabilities"
import type { CapabilitySelection, CapabilityView } from "@/lib/robozium/wire"

export function useCapabilities(project: string | null) {
	const [loaded, setLoaded] = useState<{
		project: string | null
		catalog: CapabilityView[]
		/** Saved choices reconciled with the catalogue, before the user edits them. */
		initialSelection: CapabilitySelection
	} | null>(null)
	const [error, setError] = useState<{ project: string | null; message: string } | null>(null)
	const [attempt, setAttempt] = useState(0)
	useEffect(() => {
		const controller = new AbortController()
		void Promise.all([
			listCapabilities({ signal: controller.signal }),
			project === null ? null : getProjectCapabilitySelection(project, { signal: controller.signal }),
		]).then(
			([catalog, savedSelection]) => {
				if (!controller.signal.aborted) {
					setError(null)
					setLoaded({ project, catalog, initialSelection: resolveCapabilitySelection(catalog, savedSelection) })
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
		initialSelection: loaded?.project === project ? loaded.initialSelection : null,
		error: error?.project === project ? error.message : null,
		retry: () => {
			setError(null)
			setAttempt((value) => value + 1)
		},
	}
}
