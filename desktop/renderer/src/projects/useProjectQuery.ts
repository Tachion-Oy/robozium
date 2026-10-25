// Adapted from web/app/components/hud/projects/useProjectOverview.ts at 5b06d82:
// the same polling intervals and optimistic marks. This owner only reads: launch,
// cancel and delete belong to useProjectMutations, and App passes its pending
// writes in to mark the rows.
import { useEffect, useMemo, useRef, useState } from "react"
import type { DesktopApiClient } from "../api/client"
import { withDeadline } from "../api/request"
import { listProjects } from "./projects-api"
import { markProjectsCancelling, markProjectsDeleting, markProjectOpening, mergeProjects, type ProjectRow } from "./landing"
import type { PendingMutation, ProjectMutationKind } from "./useProjectMutations"

const DEFAULT_POLL_INTERVAL_MS = 3000
const CANCELLATION_POLL_INTERVAL_MS = 250

function slugsOf(pending: ReadonlyMap<string, PendingMutation>, kind: ProjectMutationKind, phase?: PendingMutation["phase"]): string[] {
	return [...pending].filter(([, mutation]) => mutation.kind === kind && (!phase || mutation.phase === phase)).map(([slug]) => slug)
}

/** This app's writes that the rows show before a listing confirms them. */
export interface ProjectWrites {
	pending: ReadonlyMap<string, PendingMutation>
	/** Changes when a write settles, so the listing is read again. */
	revision: number
	/** The project a launch is opening. */
	opening: string | null
	/** End pending mutations whose outcome a listing shows. */
	settle: (rows: readonly ProjectRow[]) => void
}

export interface ProjectQueryState {
	isInitialLoading: boolean
	/** Set only while no listing has ever succeeded. */
	loadError: string | null
	rows: ProjectRow[]
	refresh: () => void
}

/**
 * Poll the listing while the overview is visible: at once, after each read
 * settles and after each write. A failed read keeps the last rows; rows survive
 * the overview being hidden.
 */
export function useProjectQuery(client: DesktopApiClient, visible: boolean, writes: ProjectWrites): ProjectQueryState {
	const [listed, setListed] = useState<ProjectRow[]>([])
	const [isInitialLoading, setIsInitialLoading] = useState(true)
	const [loaded, setLoaded] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [refreshes, setRefreshes] = useState(0)
	const { pending, revision, opening } = writes
	const settle = useRef(writes.settle)
	settle.current = writes.settle

	const intervalMs = slugsOf(pending, "cancel").length > 0 ? CANCELLATION_POLL_INTERVAL_MS : DEFAULT_POLL_INTERVAL_MS

	useEffect(() => {
		if (!visible) return
		const controller = new AbortController()
		let timeout: number | null = null
		const poll = async () => {
			try {
				const next = mergeProjects(await withDeadline(controller.signal, signal => listProjects(client, signal)))
				if (controller.signal.aborted) return
				settle.current(next)
				setListed(next)
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
		// A finished launch, successful or not, reads the listing again.
	}, [client, visible, intervalMs, refreshes, revision, opening])

	const rows = useMemo(() => {
		// An acknowledged deletion hides its row until a listing confirms it.
		const deleted = new Set(slugsOf(pending, "delete", "settling"))
		const shown = listed.filter(row => !deleted.has(row.slug))
		return markProjectsDeleting(markProjectsCancelling(markProjectOpening(shown, opening), slugsOf(pending, "cancel")), slugsOf(pending, "delete"))
	}, [listed, opening, pending])

	return {
		isInitialLoading,
		loadError: loaded ? null : error,
		rows,
		refresh: () => setRefreshes(count => count + 1),
	}
}
