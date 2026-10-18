import { useCallback, useEffect, useRef, useState } from "react"
import type { DesktopApiClient } from "../api/client"
import { withDeadline } from "../api/request"
import { cancelProject, type Project } from "./projects-api"

interface CancellationRequest {
	phase: "requesting" | "settling"
	controller: AbortController
}

export type CancellationResult = "requested" | "failed" | "ignored"

export interface ProjectCancellation {
	pending: ReadonlySet<string>
	error: string
	cancelWork: (slug: string) => Promise<CancellationResult>
	isCancelling: (slug: string) => boolean
	reconcile: (projects: Project[]) => string[]
}

/** Share cancellation of foreground runs and background work across project views. */
export function useProjectCancellation(client: DesktopApiClient | null): ProjectCancellation {
	const requests = useRef(new Map<string, CancellationRequest>())
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

	const reconcile = useCallback((projects: Project[]): string[] => {
		const cancelled: string[] = []
		for (const [slug, request] of requests.current) {
			if (request.phase === "requesting") continue
			const project = projects.find(row => row.slug === slug)
			if (!project || project.status === "dormant") {
				requests.current.delete(slug)
				cancelled.push(slug)
			}
		}
		publishPending()
		return cancelled
	}, [publishPending])

	async function cancelWork(slug: string): Promise<CancellationResult> {
		if (!client || requests.current.has(slug)) return "ignored"
		const request: CancellationRequest = { phase: "requesting", controller: new AbortController() }
		requests.current.set(slug, request)
		publishPending()
		setError("")

		try {
			const accepted = await withDeadline(request.controller.signal, signal => cancelProject(client, slug, signal))
			if (request.controller.signal.aborted) return "ignored"
			if (accepted) return "requested"
			requests.current.delete(slug)
			setError(`${slug}: Cancellation was not accepted. Refreshing project status.`)
			return "failed"
		} catch (failure) {
			if (request.controller.signal.aborted) return "ignored"
			requests.current.delete(slug)
			const message = failure instanceof Error ? failure.message : "Cancellation failed."
			setError(`${slug}: ${message}`)
			return "failed"
		} finally {
			if (requests.current.get(slug) === request) request.phase = "settling"
			publishPending()
		}
	}

	return { pending, error, cancelWork, reconcile, isCancelling: slug => requests.current.has(slug) }
}
