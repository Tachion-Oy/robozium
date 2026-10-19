// Poll the project listing while the overview is visible.
import { useEffect, useRef, useState } from "react"
import type { DesktopApiClient } from "../api/client"
import { withDeadline } from "../api/request"
import { listProjects } from "./projects-api"
import { mergeProjects, type ProjectRow } from "./landing"

export interface ProjectListing {
	rows: ProjectRow[]
	isInitialLoading: boolean
	/** The last failure, reported only until a listing first succeeds. */
	loadError: string | null
	refresh: () => void
	/** Remove a row locally, as after a confirmed deletion. */
	drop: (slug: string) => void
}

/**
 * Read the listing at once, then every `intervalMs` after each read settles.
 * A failed read keeps the last rows; rows survive the overview being hidden.
 */
export function useProjectListing(
	client: DesktopApiClient | null,
	visible: boolean,
	intervalMs: number,
	onListed: (rows: ProjectRow[]) => void,
): ProjectListing {
	const [rows, setRows] = useState<ProjectRow[]>([])
	const [isInitialLoading, setIsInitialLoading] = useState(true)
	const [loaded, setLoaded] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [refreshes, setRefreshes] = useState(0)
	const listed = useRef(onListed)
	listed.current = onListed

	useEffect(() => {
		if (!client || !visible) return
		const controller = new AbortController()
		let timeout: number | null = null
		const poll = async () => {
			try {
				const next = mergeProjects(await withDeadline(controller.signal, signal => listProjects(client, signal)))
				if (controller.signal.aborted) return
				listed.current(next)
				setRows(next)
				setLoaded(true)
				setError(null)
			} catch (failure) {
				// Keep the last successful table through a transient read failure.
				if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Could not load projects.")
			} finally {
				if (!controller.signal.aborted) {
					setIsInitialLoading(false)
					timeout = window.setTimeout(() => void poll(), intervalMs)
				}
			}
		}
		void poll()
		return () => {
			controller.abort()
			if (timeout !== null) window.clearTimeout(timeout)
		}
	}, [client, visible, intervalMs, refreshes])

	return {
		rows,
		isInitialLoading,
		loadError: loaded ? null : error,
		refresh: () => setRefreshes(count => count + 1),
		drop: slug => setRows(current => current.filter(row => row.slug !== slug)),
	}
}
