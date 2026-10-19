// Copied from web/app/components/hud/projects/useProjectOverview.ts at 5b06d82.
// Adapted: reads use the desktop client with deadlines and poll only while the
// overview is visible, so rows survive leaving it. The reference container's
// cancel and delete requests move here, so the overview makes no requests.
import { useEffect, useMemo, useRef, useState } from "react"
import type { DesktopApiClient } from "../api/client"
import { withDeadline } from "../api/request"
import { showErrorToast } from "../feedback/notices"
import { cancelProject, deleteProject, listProjects } from "./projects-api"
import {
	markProjectsCancelling,
	markProjectsDeleting,
	markProjectOpening,
	mergeProjects,
	ProjectStatus,
	type ProjectRow,
} from "./landing"

const DEFAULT_POLL_INTERVAL_MS = 3000
const CANCELLATION_POLL_INTERVAL_MS = 250

function withoutSlug(slugs: ReadonlySet<string>, slug: string) {
	return new Set([...slugs].filter((current) => current !== slug))
}

export interface ProjectOverviewState {
	isInitialLoading: boolean
	rows: ProjectRow[]
	refresh: () => void
	markOpening: (slug: string) => void
	clearOpening: (slug: string) => void
	cancel: (slug: string) => Promise<void>
	remove: (slug: string) => Promise<void>
}

export function useProjectOverview(client: DesktopApiClient | null, visible: boolean): ProjectOverviewState {
	const [isInitialLoading, setIsInitialLoading] = useState(true)
	const [pendingOpenSlug, setPendingOpenSlug] = useState<string | null>(null)
	const [pendingCancels, setPendingCancels] = useState<ReadonlySet<string>>(
		new Set(),
	)
	const [pendingDeletes, setPendingDeletes] = useState<ReadonlySet<string>>(
		new Set(),
	)
	const [polledRows, setPolledRows] = useState<ProjectRow[]>([])
	const [refreshNonce, setRefreshNonce] = useState(0)
	// Writes belong to the client's lifetime; a new client discards their outcomes.
	const writes = useRef(new AbortController())
	useEffect(() => {
		writes.current = new AbortController()
		return () => writes.current.abort()
	}, [client])

	const rows = useMemo(
		() =>
			markProjectsDeleting(
				markProjectsCancelling(
					markProjectOpening(polledRows, pendingOpenSlug),
					pendingCancels,
				),
				pendingDeletes,
			),
		[polledRows, pendingOpenSlug, pendingCancels, pendingDeletes],
	)

	useEffect(() => {
		if (!client || !visible) return
		const controller = new AbortController()
		let timeoutId: number | null = null
		const intervalMs =
			pendingCancels.size > 0
				? CANCELLATION_POLL_INTERVAL_MS
				: DEFAULT_POLL_INTERVAL_MS

		const poll = async () => {
			try {
				const nextRows = mergeProjects(await withDeadline(controller.signal, signal => listProjects(client, signal)))
				if (controller.signal.aborted) return
				const statusBySlug = new Map(
					nextRows.map((row) => [row.slug, row.status] as const),
				)
				setPendingCancels((current) => {
					const retained = new Set(
						[...current].filter((slug) => {
							const status = statusBySlug.get(slug)
							return (
								status !== undefined &&
								status !== ProjectStatus.Dormant
							)
						}),
					)
					return retained.size === current.size ? current : retained
				})
				setPendingDeletes(
					(current) =>
						new Set(
							[...current].filter((slug) =>
								statusBySlug.has(slug),
							),
						),
				)
				setPolledRows(nextRows)
			} catch {
				if (controller.signal.aborted) return
				// Keep the last successful table through a transient refresh failure.
			} finally {
				if (!controller.signal.aborted) {
					setIsInitialLoading(false)
					timeoutId = window.setTimeout(() => void poll(), intervalMs)
				}
			}
		}

		void poll()
		return () => {
			controller.abort()
			if (timeoutId !== null) window.clearTimeout(timeoutId)
		}
	}, [client, visible, refreshNonce, pendingCancels])

	const refresh = () => setRefreshNonce((nonce) => nonce + 1)
	// Each write runs once, under the client's lifetime and a deadline.
	const write = <T,>(operation: (client: DesktopApiClient, signal: AbortSignal) => Promise<T>) => {
		const lifetime = writes.current
		const result = client
			? withDeadline(lifetime.signal, signal => operation(client, signal))
			: Promise.reject(new Error("The backend is not connected."))
		return { lifetime, result }
	}

	const cancel = async (slug: string) => {
		setPendingCancels((current) => new Set(current).add(slug))
		const { lifetime, result } = write((client, signal) => cancelProject(client, slug, signal))
		try {
			if (!await result) {
				setPendingCancels((current) => withoutSlug(current, slug))
				showErrorToast({
					title: "Cancellation failed",
					message: `Could not cancel "${slug}".`,
					detail: "The project is still active. Try again.",
				})
			}
		} catch {
			if (lifetime.signal.aborted) return
			setPendingCancels((current) => withoutSlug(current, slug))
			showErrorToast({
				title: "Cancellation failed",
				message: `Could not cancel "${slug}".`,
				detail: "The cancellation request failed. Try again.",
			})
		} finally {
			if (!lifetime.signal.aborted) refresh()
		}
	}

	const remove = async (slug: string) => {
		setPendingDeletes((current) => new Set(current).add(slug))
		const { lifetime, result } = write((client, signal) => deleteProject(client, slug, signal))
		try {
			await result
			setPolledRows((current) =>
				current.filter((row) => row.slug !== slug),
			)
		} catch {
			if (lifetime.signal.aborted) return
			setPendingDeletes((current) => withoutSlug(current, slug))
			showErrorToast({
				title: "Deletion failed",
				message: `Could not delete "${slug}".`,
				detail: "The project was not deleted. Try again.",
			})
		} finally {
			if (!lifetime.signal.aborted) refresh()
		}
	}

	return {
		isInitialLoading,
		rows,
		refresh,
		markOpening: (slug: string) => setPendingOpenSlug(slug),
		clearOpening: (slug: string) =>
			setPendingOpenSlug((current) =>
				current === slug ? null : current,
			),
		cancel,
		remove,
	}
}
