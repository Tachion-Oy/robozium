import { useCallback, useEffect, useRef, useState } from "react"
import { ApiError, type DesktopApiClient } from "../api/client"
import { withDeadline } from "../api/request"
import { cancelProject, deleteProject, type Project } from "./projects-api"

interface ProjectOperation {
	kind: "cancel" | "delete"
	phase: "requesting" | "settling"
	controller: AbortController
}

interface PendingProjects {
	cancelling: ReadonlySet<string>
	deleting: ReadonlySet<string>
}

type DeletionResult = "deleted" | "uncertain" | "ignored"

function deletionError(error: unknown): string {
	if (error instanceof ApiError && error.status === 409) {
		return "Deletion blocked: active work must finish before deleting."
	}
	return error instanceof Error ? error.message : "Deletion failed."
}

/** Own cancellation/deletion requests until HTTP and project listings settle them. */
export function useProjectMutations(client: DesktopApiClient | null) {
	const operations = useRef(new Map<string, ProjectOperation>())
	const confirmedDeletions = useRef(new Set<string>())
	const [pending, setPending] = useState<PendingProjects>({
		cancelling: new Set(),
		deleting: new Set(),
	})
	const [error, setError] = useState("")

	// The registry guards synchronous double clicks; React receives a render snapshot.
	const publishPending = useCallback(() => {
		const cancelling = new Set<string>()
		const deleting = new Set<string>()
		for (const [slug, operation] of operations.current) {
			if (operation.kind === "cancel") cancelling.add(slug)
			else deleting.add(slug)
		}
		setPending({ cancelling, deleting })
	}, [])

	useEffect(() => {
		const requests = operations.current
		return () => {
			for (const operation of requests.values()) {
				operation.controller.abort()
			}
			requests.clear()
			publishPending()
		}
	}, [client, publishPending])

	const reconcile = useCallback((listed: Project[], previous: Project[]) => {
		const rows = [...listed]
		const deleted: string[] = []
		const cancelled: string[] = []

		for (const [slug, operation] of operations.current) {
			const project = listed.find(row => row.slug === slug)

			if (operation.phase === "requesting") {
				// Keep "Deleting…" visible even if a poll overtakes the DELETE reply.
				if (operation.kind === "delete" && !project) {
					const previousRow = previous.find(row => row.slug === slug)
					if (previousRow) rows.push(previousRow)
				}
				continue
			}

			if (operation.kind === "delete") {
				operations.current.delete(slug)
				if (!project) {
					confirmedDeletions.current.add(slug)
					deleted.push(slug)
				}
				continue
			}

			if (!project || project.status === "dormant") {
				operations.current.delete(slug)
				cancelled.push(slug)
			}
		}

		// An acknowledged deletion can overlap an older listing containing the row.
		// Suppress that row until a later listing confirms its absence.
		for (const slug of confirmedDeletions.current) {
			if (!listed.some(row => row.slug === slug)) {
				confirmedDeletions.current.delete(slug)
			}
		}
		publishPending()

		return {
			rows: rows.filter(row => !confirmedDeletions.current.has(row.slug)),
			deleted,
			cancelled,
		}
	}, [publishPending])

	async function cancel(slug: string): Promise<boolean> {
		if (!client || operations.current.has(slug)) return false

		const request = new AbortController()
		const operation: ProjectOperation = { kind: "cancel", phase: "requesting", controller: request }
		operations.current.set(slug, operation)
		publishPending()
		setError("")

		try {
			const accepted = await withDeadline(request.signal, signal => cancelProject(client, slug, signal))
			if (request.signal.aborted) return false

			if (!accepted) {
				operations.current.delete(slug)
				setError(`${slug}: Cancellation was not accepted. Refreshing project status.`)
			}
		} catch (failure) {
			if (request.signal.aborted) return false
			operations.current.delete(slug)
			const message = failure instanceof Error ? failure.message : "Cancellation failed."
			setError(`${slug}: ${message}`)
		} finally {
			if (operations.current.get(slug) === operation) {
				operation.phase = "settling"
			}
			publishPending()
		}

		return true
	}

	async function remove(slug: string): Promise<DeletionResult> {
		if (!client || operations.current.has(slug)) return "ignored"

		const request = new AbortController()
		const operation: ProjectOperation = { kind: "delete", phase: "requesting", controller: request }
		operations.current.set(slug, operation)
		publishPending()
		setError("")

		try {
			await withDeadline(request.signal, signal => deleteProject(client, slug, signal))
			if (request.signal.aborted) return "ignored"

			operations.current.delete(slug)
			confirmedDeletions.current.add(slug)
			return "deleted"
		} catch (failure) {
			if (request.signal.aborted) return "ignored"
			setError(`${slug}: ${deletionError(failure)}`)
			return "uncertain"
		} finally {
			if (operations.current.get(slug) === operation) {
				operation.phase = "settling"
			}
			publishPending()
		}
	}

	function hasPendingDeletion(): boolean {
		return [...operations.current.values()].some(operation => operation.kind === "delete")
	}

	function forgetDeletion(slug: string) {
		confirmedDeletions.current.delete(slug)
	}

	return {
		...pending,
		error,
		cancel,
		remove,
		reconcile,
		hasOperation: (slug: string) => operations.current.has(slug),
		hasPendingDeletion,
		forgetDeletion,
	}
}
