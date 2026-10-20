// This app's cancel and delete requests per project, until a listing confirms them.
// Rows belong to the overview; this owner only knows which requests it sent.
import { useEffect, useState } from "react"
import type { DesktopApiClient } from "../api/client"
import { withDeadline } from "../api/request"
import { useClientLifetime } from "../api/useClientLifetime"
import { showErrorToast } from "../feedback/notices"
import { cancelProject, deleteProject } from "./projects-api"
import { ProjectStatus, type ProjectRow } from "./landing"

export type ProjectMutationKind = "cancel" | "delete"

/**
 * A mutation is "requesting" until its request settles, then "settling" until a
 * listing confirms it. A listing never ends a mutation that is still requesting,
 * so a late cancellation cannot reach a run launched in the meantime.
 */
export interface PendingMutation {
	kind: ProjectMutationKind
	phase: "requesting" | "settling"
}

export interface ProjectMutations {
	pending: ReadonlyMap<string, PendingMutation>
	/** Changes whenever a request settles, so a listing can be read again. */
	revision: number
	cancel: (slug: string) => Promise<void>
	remove: (slug: string) => Promise<void>
	/** End settling mutations whose outcome this listing shows. */
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

function confirmed({ kind }: PendingMutation, status: ProjectStatus | undefined): boolean {
	return kind === "delete" ? status === undefined : status === undefined || status === ProjectStatus.Dormant
}

export function useProjectMutations(client: DesktopApiClient | null): ProjectMutations {
	const [pending, setPending] = useState<ReadonlyMap<string, PendingMutation>>(() => new Map())
	const [revision, setRevision] = useState(0)
	const lifetime = useClientLifetime(client)
	// A new client discards the previous client's mutations with their lifetime.
	useEffect(() => () => setPending(new Map()), [client])

	const update = (slug: string, mutation: PendingMutation | null) => setPending(current => {
		const next = new Map(current)
		if (mutation) next.set(slug, mutation)
		else next.delete(slug)
		return next
	})

	/** Send one mutation and never repeat it; its settling changes the revision. */
	const send = async (
		slug: string,
		kind: ProjectMutationKind,
		operation: (client: DesktopApiClient, signal: AbortSignal) => Promise<boolean>,
		notice: WriteNotice,
	): Promise<void> => {
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
				setRevision(count => count + 1)
			}
		}
	}

	return {
		pending,
		revision,
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
				const next = new Map([...current].filter(([slug, mutation]) =>
					mutation.phase === "requesting" || !confirmed(mutation, status.get(slug))))
				return next.size === current.size ? current : next
			})
		},
	}
}
