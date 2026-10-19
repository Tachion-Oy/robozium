// Adapted from web/app/components/hud/projects/useProjectOverview.ts at 5b06d82:
// the same polling intervals, optimistic marks and the rules that settle them,
// split into the listing, slug sets and one write helper. The reference
// container's cancel and delete requests move here, so the overview makes none.
import { useMemo, useState } from "react"
import type { DesktopApiClient } from "../api/client"
import { withDeadline } from "../api/request"
import { useClientLifetime } from "../api/useClientLifetime"
import { showErrorToast } from "../feedback/notices"
import { cancelProject, deleteProject } from "./projects-api"
import { markProjectsCancelling, markProjectsDeleting, markProjectOpening, ProjectStatus, type ProjectRow } from "./landing"
import { useProjectListing } from "./useProjectListing"
import { useSlugSet, type SlugSet } from "./useSlugSet"

const DEFAULT_POLL_INTERVAL_MS = 3000
const CANCELLATION_POLL_INTERVAL_MS = 250

export interface ProjectOverviewState {
	isInitialLoading: boolean
	rows: ProjectRow[]
	refresh: () => void
	markOpening: (slug: string) => void
	clearOpening: (slug: string) => void
	cancel: (slug: string) => Promise<void>
	remove: (slug: string) => Promise<void>
}

interface WriteNotice {
	title: string
	message: string
	/** Shown when the backend answers but refuses. */
	refused?: string
	/** Shown when the request itself fails. */
	failed: string
}

export function useProjectOverview(client: DesktopApiClient | null, visible: boolean): ProjectOverviewState {
	const [opening, setOpening] = useState<string | null>(null)
	const cancelling = useSlugSet()
	const deleting = useSlugSet()
	const lifetime = useClientLifetime(client)
	const listing = useProjectListing(
		client,
		visible,
		cancelling.slugs.size > 0 ? CANCELLATION_POLL_INTERVAL_MS : DEFAULT_POLL_INTERVAL_MS,
		listed => {
			// A cancel settles once its project is dormant or gone; a delete once it is gone.
			const status = new Map(listed.map(row => [row.slug, row.status] as const))
			cancelling.retain(slug => status.has(slug) && status.get(slug) !== ProjectStatus.Dormant)
			deleting.retain(slug => status.has(slug))
		},
	)

	const rows = useMemo(
		() => markProjectsDeleting(markProjectsCancelling(markProjectOpening(listing.rows, opening), cancelling.slugs), deleting.slugs),
		[listing.rows, opening, cancelling.slugs, deleting.slugs],
	)

	/** Send one write under the client's lifetime; never repeat it, and read again afterwards. */
	const write = async (
		slug: string,
		marks: SlugSet,
		operation: (client: DesktopApiClient, signal: AbortSignal) => Promise<boolean>,
		notice: WriteNotice,
	): Promise<boolean> => {
		marks.add(slug)
		const signal = lifetime()
		try {
			if (!client) throw new Error("The backend is not connected.")
			if (await withDeadline(signal, requestSignal => operation(client, requestSignal))) return true
			marks.remove(slug)
			showErrorToast({ title: notice.title, message: notice.message, detail: notice.refused })
		} catch {
			if (signal.aborted) return false
			marks.remove(slug)
			showErrorToast({ title: notice.title, message: notice.message, detail: notice.failed })
		} finally {
			if (!signal.aborted) listing.refresh()
		}
		return false
	}

	return {
		isInitialLoading: listing.isInitialLoading,
		rows,
		refresh: listing.refresh,
		markOpening: setOpening,
		clearOpening: slug => setOpening(current => current === slug ? null : current),
		cancel: async slug => {
			await write(slug, cancelling, (client, signal) => cancelProject(client, slug, signal), {
				title: "Cancellation failed",
				message: `Could not cancel "${slug}".`,
				refused: "The project is still active. Try again.",
				failed: "The cancellation request failed. Try again.",
			})
		},
		remove: async slug => {
			const deleted = await write(slug, deleting, async (client, signal) => {
				await deleteProject(client, slug, signal)
				return true
			}, {
				title: "Deletion failed",
				message: `Could not delete "${slug}".`,
				failed: "The project was not deleted. Try again.",
			})
			if (deleted) listing.drop(slug)
		},
	}
}
