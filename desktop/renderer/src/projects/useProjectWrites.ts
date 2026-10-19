// This app's cancel and delete requests per project, until a listing confirms them.
// Rows belong to the overview; this owner only knows which requests it sent.
import { useEffect, useState } from "react"
import type { DesktopApiClient } from "../api/client"
import { withDeadline } from "../api/request"
import { useClientLifetime } from "../api/useClientLifetime"
import { showErrorToast } from "../feedback/notices"
import { cancelProject, deleteProject } from "./projects-api"
import { ProjectStatus, type ProjectRow } from "./landing"

export type ProjectWriteKind = "cancel" | "delete"

/**
 * A write is "requesting" until its request settles, then "settling" until a
 * listing confirms it. A listing never ends a write that is still requesting,
 * so a late cancellation cannot reach a run launched in the meantime.
 */
export interface PendingWrite {
	kind: ProjectWriteKind
	phase: "requesting" | "settling"
}

export interface ProjectWrites {
	pending: ReadonlyMap<string, PendingWrite>
	cancel: (slug: string) => Promise<void>
	/** Resolves true once the backend acknowledged the deletion. */
	remove: (slug: string) => Promise<boolean>
	/** End settling writes whose outcome this listing shows. */
	settle: (rows: readonly ProjectRow[]) => void
}

interface WriteNotice {
	title: string
	message: string
	/** Shown when the backend answers but refuses. */
	refused?: string
	/** Shown when the request itself fails. */
	failed: string
}

function confirmed({ kind }: PendingWrite, status: ProjectStatus | undefined): boolean {
	return kind === "delete" ? status === undefined : status === undefined || status === ProjectStatus.Dormant
}

export function useProjectWrites(client: DesktopApiClient | null, refresh: () => void): ProjectWrites {
	const [pending, setPending] = useState<ReadonlyMap<string, PendingWrite>>(() => new Map())
	const lifetime = useClientLifetime(client)
	// A new client discards the previous client's writes with their lifetime.
	useEffect(() => () => setPending(new Map()), [client])

	const update = (slug: string, write: PendingWrite | null) => setPending(current => {
		const next = new Map(current)
		if (write) next.set(slug, write)
		else next.delete(slug)
		return next
	})

	/** Send one write; never repeat it, and read again once it settles. */
	const send = async (
		slug: string,
		kind: ProjectWriteKind,
		operation: (client: DesktopApiClient, signal: AbortSignal) => Promise<boolean>,
		notice: WriteNotice,
	): Promise<boolean> => {
		update(slug, { kind, phase: "requesting" })
		const signal = lifetime()
		let accepted = false
		try {
			if (!client) throw new Error("The backend is not connected.")
			accepted = await withDeadline(signal, requestSignal => operation(client, requestSignal))
			if (!accepted) showErrorToast({ title: notice.title, message: notice.message, detail: notice.refused })
		} catch {
			if (!signal.aborted) showErrorToast({ title: notice.title, message: notice.message, detail: notice.failed })
		} finally {
			if (!signal.aborted) {
				update(slug, accepted ? { kind, phase: "settling" } : null)
				refresh()
			}
		}
		return accepted
	}

	return {
		pending,
		cancel: async slug => {
			await send(slug, "cancel", (client, signal) => cancelProject(client, slug, signal), {
				title: "Cancellation failed",
				message: `Could not cancel "${slug}".`,
				refused: "The project is still active. Try again.",
				failed: "The cancellation request failed. Try again.",
			})
		},
		remove: slug => send(slug, "delete", async (client, signal) => {
			await deleteProject(client, slug, signal)
			return true
		}, {
			title: "Deletion failed",
			message: `Could not delete "${slug}".`,
			failed: "The project was not deleted. Try again.",
		}),
		settle: rows => {
			const status = new Map(rows.map(row => [row.slug, row.status] as const))
			setPending(current => {
				const next = new Map([...current].filter(([slug, write]) =>
					write.phase === "requesting" || !confirmed(write, status.get(slug))))
				return next.size === current.size ? current : next
			})
		},
	}
}
