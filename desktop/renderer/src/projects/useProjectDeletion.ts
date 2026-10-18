import { useCallback, useEffect, useRef, useState } from "react"
import { ApiError, type DesktopApiClient } from "../api/client"
import { withDeadline } from "../api/request"
import { deleteProject, type Project } from "./projects-api"

interface DeletionRequest {
	phase: "requesting" | "settling"
	controller: AbortController
}

export type DeletionResult = "deleted" | "uncertain" | "ignored"

export interface DeletionReconciliation {
	projects: Project[]
	deleted: string[]
}

export interface ProjectDeletion {
	pending: ReadonlySet<string>
	error: string
	deleteProject: (slug: string) => Promise<DeletionResult>
	reconcile: (listed: Project[], previous: Project[]) => DeletionReconciliation
	isDeleting: (slug: string) => boolean
	hasPendingDeletion: () => boolean
	forgetDeletion: (slug: string) => void
}

function deletionError(error: unknown): string {
	if (error instanceof ApiError && error.status === 409) {
		return "Deletion blocked: active work must finish before deleting."
	}
	return error instanceof Error ? error.message : "Deletion failed."
}

/** Retain deletion intent until an acknowledgement or a fresh listing settles it. */
export function useProjectDeletion(client: DesktopApiClient | null): ProjectDeletion {
	const requests = useRef(new Map<string, DeletionRequest>())
	const confirmedDeletions = useRef(new Set<string>())
	const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
	const [error, setError] = useState("")

	const publishPending = useCallback((): void => {
		setPending(new Set(requests.current.keys()))
	}, [])

	useEffect(() => {
		const active = requests.current
		return () => {
			for (const request of active.values()) request.controller.abort()
			active.clear()
			publishPending()
		}
	}, [client, publishPending])

	const reconcile = useCallback((listed: Project[], previous: Project[]): DeletionReconciliation => {
		const projects = [...listed]
		const deleted: string[] = []

		for (const [slug, request] of requests.current) {
			const present = listed.some(project => project.slug === slug)
			if (request.phase === "requesting") {
				// A poll can overtake DELETE; keep its row and pending feedback until HTTP settles.
				const previousProject = previous.find(project => project.slug === slug)
				if (!present && previousProject) projects.push(previousProject)
				continue
			}

			requests.current.delete(slug)
			if (!present) {
				confirmedDeletions.current.add(slug)
				deleted.push(slug)
			}
		}

		// Suppress acknowledged deletions in older listings until absence is confirmed.
		for (const slug of confirmedDeletions.current) {
			if (!listed.some(project => project.slug === slug)) confirmedDeletions.current.delete(slug)
		}
		publishPending()
		return { projects: projects.filter(project => !confirmedDeletions.current.has(project.slug)), deleted }
	}, [publishPending])

	async function removeProject(slug: string): Promise<DeletionResult> {
		if (!client || requests.current.has(slug)) return "ignored"
		const request: DeletionRequest = { phase: "requesting", controller: new AbortController() }
		requests.current.set(slug, request)
		publishPending()
		setError("")

		try {
			await withDeadline(request.controller.signal, signal => deleteProject(client, slug, signal))
			if (request.controller.signal.aborted) return "ignored"
			requests.current.delete(slug)
			confirmedDeletions.current.add(slug)
			return "deleted"
		} catch (failure) {
			if (request.controller.signal.aborted) return "ignored"
			setError(`${slug}: ${deletionError(failure)}`)
			return "uncertain"
		} finally {
			if (requests.current.get(slug) === request) request.phase = "settling"
			publishPending()
		}
	}

	return {
		pending,
		error,
		deleteProject: removeProject,
		reconcile,
		isDeleting: slug => requests.current.has(slug),
		hasPendingDeletion: () => requests.current.size > 0,
		forgetDeletion: slug => { confirmedDeletions.current.delete(slug) },
	}
}
