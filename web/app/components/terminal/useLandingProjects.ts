"use client"

import { useEffect, useMemo, useState } from "react"
import { listProjects } from "@/lib/robosprawl/client"
import {
	markProjectsCancelling,
	markProjectsDeleting,
	markProjectOpening,
	mergeProjects,
	ProjectStatus,
	type ProjectRow,
} from "@/lib/robosprawl/landing"
import type { Project } from "@/lib/robosprawl/wire"

const DEFAULT_POLL_INTERVAL_MS = 3000
const CANCELLATION_POLL_INTERVAL_MS = 250

function withoutSlug(slugs: ReadonlySet<string>, slug: string) {
	return new Set([...slugs].filter((current) => current !== slug))
}

export function useLandingProjects(initialProjects: Project[] | null) {
	const [isInitialLoading, setIsInitialLoading] = useState(
		initialProjects === null,
	)
	const [pendingOpenSlug, setPendingOpenSlug] = useState<string | null>(null)
	const [pendingCancels, setPendingCancels] = useState<ReadonlySet<string>>(
		new Set(),
	)
	const [pendingDeletes, setPendingDeletes] = useState<ReadonlySet<string>>(
		new Set(),
	)
	const [polledRows, setPolledRows] = useState<ProjectRow[]>(() =>
		initialProjects ? mergeProjects(initialProjects) : [],
	)
	const [refreshNonce, setRefreshNonce] = useState(0)

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
		let active = true
		let timeoutId: number | null = null
		const intervalMs = pendingCancels.size > 0
			? CANCELLATION_POLL_INTERVAL_MS
			: DEFAULT_POLL_INTERVAL_MS

		const poll = async () => {
			try {
				const nextRows = mergeProjects(await listProjects())
				if (!active) return
				const statusBySlug = new Map(
					nextRows.map((row) => [row.slug, row.status] as const),
				)
				setPendingCancels(
					(current) => {
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
					},
				)
				setPendingDeletes(
					(current) =>
						new Set([...current].filter((slug) => statusBySlug.has(slug))),
				)
				setPolledRows(nextRows)
			} catch {
				if (!active) return
				setPolledRows([])
			} finally {
				if (active) {
					setIsInitialLoading(false)
					timeoutId = window.setTimeout(() => void poll(), intervalMs)
				}
			}
		}

		void poll()
		return () => {
			active = false
			if (timeoutId !== null) window.clearTimeout(timeoutId)
		}
	}, [refreshNonce, pendingCancels])

	return {
		isInitialLoading,
		rows,
		refresh: () => setRefreshNonce((nonce) => nonce + 1),
		markOpening: (slug: string) => setPendingOpenSlug(slug),
		clearOpening: (slug: string) =>
			setPendingOpenSlug((current) => (current === slug ? null : current)),
		markCancelling: (slug: string) =>
			setPendingCancels((current) => new Set(current).add(slug)),
		clearCancelling: (slug: string) =>
			setPendingCancels((current) => withoutSlug(current, slug)),
		markDeleting: (slug: string) =>
			setPendingDeletes((current) => new Set(current).add(slug)),
		clearDeleting: (slug: string) =>
			setPendingDeletes((current) => withoutSlug(current, slug)),
		remove: (slug: string) =>
			setPolledRows((current) =>
				current.filter((row) => row.slug !== slug),
			),
	}
}
