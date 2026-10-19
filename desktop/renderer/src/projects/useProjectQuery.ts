// Adapted from web/app/components/hud/projects/useProjectOverview.ts at 5b06d82:
// the same polling intervals and optimistic marks. Rows and polling live here;
// cancel and delete requests, which the reference container sent, belong to
// useProjectMutations, so the overview component makes no requests.
import { useEffect, useMemo, useRef, useState } from "react"
import type { DesktopApiClient } from "../api/client"
import { withDeadline } from "../api/request"
import { listProjects } from "./projects-api"
import { markProjectsCancelling, markProjectsDeleting, markProjectOpening, mergeProjects, type ProjectRow } from "./landing"
import { useProjectMutations, type PendingMutation, type ProjectMutationKind } from "./useProjectMutations"

const DEFAULT_POLL_INTERVAL_MS = 3000
const CANCELLATION_POLL_INTERVAL_MS = 250

function slugsOf(pending: ReadonlyMap<string, PendingMutation>, kind: ProjectMutationKind): string[] {
	return [...pending].filter(([, mutation]) => mutation.kind === kind).map(([slug]) => slug)
}

export interface ProjectQueryState {
	isInitialLoading: boolean
	/** Set only while no listing has ever succeeded. */
	loadError: string | null
	rows: ProjectRow[]
	refresh: () => void
	markOpening: (slug: string) => void
	clearOpening: (slug: string) => void
	cancel: (slug: string) => Promise<void>
	remove: (slug: string) => Promise<void>
}

/**
 * Poll the listing while the overview is visible: at once, then after each read
 * settles. A failed read keeps the last rows; rows survive the overview being hidden.
 */
export function useProjectQuery(client: DesktopApiClient | null, visible: boolean): ProjectQueryState {
	const [listed, setListed] = useState<ProjectRow[]>([])
	const [isInitialLoading, setIsInitialLoading] = useState(true)
	const [loaded, setLoaded] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [refreshes, setRefreshes] = useState(0)
	const [opening, setOpening] = useState<string | null>(null)
	const refresh = () => setRefreshes(count => count + 1)
	const mutations = useProjectMutations(client, refresh)
	const settle = useRef(mutations.settle)
	settle.current = mutations.settle

	const pending = mutations.pending
	const intervalMs = slugsOf(pending, "cancel").length > 0 ? CANCELLATION_POLL_INTERVAL_MS : DEFAULT_POLL_INTERVAL_MS

	useEffect(() => {
		if (!client || !visible) return
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
	}, [client, visible, intervalMs, refreshes])

	const rows = useMemo(
		() => markProjectsDeleting(markProjectsCancelling(markProjectOpening(listed, opening), slugsOf(pending, "cancel")), slugsOf(pending, "delete")),
		[listed, opening, pending],
	)

	return {
		isInitialLoading,
		loadError: loaded ? null : error,
		rows,
		refresh,
		markOpening: setOpening,
		clearOpening: slug => setOpening(current => current === slug ? null : current),
		cancel: mutations.cancel,
		remove: async slug => {
			if (await mutations.remove(slug)) setListed(current => current.filter(row => row.slug !== slug))
		},
	}
}
