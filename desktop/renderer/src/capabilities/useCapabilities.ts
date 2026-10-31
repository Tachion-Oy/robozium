// Reads use the desktop client with one deadline and run only while
// the selector is open; App owns this state and passes it to the selector.
// Closing the selector forgets the reads, so reopening it never offers choices
// older than the last save.
import { useEffect, useState } from "react"
import type { DesktopApiClient } from "../api/client"
import { withDeadline } from "../api/request"
import { getProjectSelection, listCapabilities, type CapabilitySelection, type CapabilityView } from "./capabilities-api"
import { resolveCapabilitySelection } from "./capabilities"

export interface CapabilitiesState {
	catalog: CapabilityView[] | null
	/** Saved choices reconciled with the catalogue, before the user edits them. */
	initialSelection: CapabilitySelection | null
	error: string | null
	retry: () => void
}

export function useCapabilities(client: DesktopApiClient, project: string | null, active: boolean): CapabilitiesState {
	const [loaded, setLoaded] = useState<{
		project: string | null
		catalog: CapabilityView[]
		initialSelection: CapabilitySelection
	} | null>(null)
	const [error, setError] = useState<{ project: string | null; message: string } | null>(null)
	const [attempt, setAttempt] = useState(0)
	useEffect(() => {
		if (!active) return
		const controller = new AbortController()
		const load = async () => {
			try {
				const [catalog, savedSelection] = await withDeadline(controller.signal, signal => Promise.all([
					listCapabilities(client, signal),
					project === null ? null : getProjectSelection(client, project, signal),
				]))
				if (controller.signal.aborted) return
				setError(null)
				setLoaded({ project, catalog, initialSelection: resolveCapabilitySelection(catalog, savedSelection) })
			} catch (error) {
				if (!controller.signal.aborted) {
					setError({ project, message: error instanceof Error ? error.message : "Could not load capabilities." })
				}
			}
		}
		void load()
		return () => {
			controller.abort()
			setLoaded(null)
			setError(null)
		}
	}, [client, active, attempt, project])
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
