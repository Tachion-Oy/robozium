// This app's launch, cancel and delete requests per project, until a listing confirms them.
// Rows belong to the overview; this owner only knows which requests it sent.
// The launch is adapted from web/hooks/useProjectLaunch.ts at 5b06d82: requests
// use the desktop client under one abortable lifetime with deadlines; a launching
// flag replaces the shared navigation lock; a launched run is handed to the caller
// instead of navigating; a locked backend is reported to the caller, which reads
// the secrets status again.
import { useEffect, useRef, useState } from "react"
import type { DesktopApiClient } from "../api/client"
import { withDeadline } from "../api/request"
import { useClientLifetime } from "../api/useClientLifetime"
import type { LaunchDraft } from "../app/hud-navigation"
import { resolveCapabilitySelection } from "../capabilities/capabilities"
import { getProjectSelection, listCapabilities, saveProjectSelection } from "../capabilities/capabilities-api"
import { isSecretsLocked, showSecretsLocked } from "../credentials/locked"
import { showErrorToast } from "../feedback/notices"
import { createRun } from "../run/run-api"
import { cancelProject, createProject, deleteProject } from "./projects-api"
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
	/** Launch commands outlive the selector; failures remain visible after dismissal. */
	launch: (draft: LaunchDraft) => Promise<boolean>
	launching: boolean
	/** The existing project being launched; a new project has no row yet. */
	opening: string | null
	/** Read synchronously, so a second click before the next render is refused. */
	isLaunching: () => boolean
}

export interface LaunchCallbacks {
	onLaunched: (runId: string, project: string) => void
	onProjectCreated: (name: string, project: string) => void
	onSecretsLocked: () => void
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

export function useProjectMutations(
	client: DesktopApiClient,
	{ onLaunched, onProjectCreated, onSecretsLocked }: LaunchCallbacks,
): ProjectMutations {
	const [pending, setPending] = useState<ReadonlyMap<string, PendingMutation>>(() => new Map())
	const [revision, setRevision] = useState(0)
	const lifetime = useClientLifetime(client)
	const activeLaunch = useRef<AbortController | null>(null)
	const [launching, setLaunching] = useState(false)
	const [opening, setOpening] = useState<string | null>(null)
	// A new client discards the previous client's mutations with their lifetime.
	useEffect(() => () => {
		setPending(new Map())
		activeLaunch.current?.abort()
		activeLaunch.current = null
		setLaunching(false)
		setOpening(null)
	}, [client])

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

	const launch = async ({ project, name, selection: draftSelection }: LaunchDraft): Promise<boolean> => {
		if (activeLaunch.current) return false
		const controller = new AbortController()
		activeLaunch.current = controller
		setLaunching(true)
		setOpening(project)
		const request = <T,>(operation: (signal: AbortSignal) => Promise<T>) => withDeadline(controller.signal, operation)
		try {
			// Writes are never repeated automatically; a created project is reported
			// at once so that launching again reuses it instead of creating another.
			const slug = project ?? await request(signal => createProject(client, name.trim(), signal))
			if (project === null) onProjectCreated(name.trim(), slug)
			const selection = draftSelection ?? await request(async signal => {
				const [catalog, savedSelection] = await Promise.all([
					listCapabilities(client, signal), getProjectSelection(client, slug, signal),
				])
				return resolveCapabilitySelection(catalog, savedSelection)
			})
			await request(signal => saveProjectSelection(client, slug, selection, signal))
			const runId = await request(signal => createRun(client, slug, selection, signal))
			onLaunched(runId, slug)
			return true
		} catch (error) {
			if (controller.signal.aborted) return false
			if (isSecretsLocked(error)) {
				showSecretsLocked("Unlock secrets before starting a run.")
				onSecretsLocked()
				return false
			}
			showErrorToast({
				title: "Launch failed",
				message: error instanceof Error ? error.message : "Unable to launch project. Try again.",
			})
			return false
		} finally {
			if (activeLaunch.current === controller) {
				activeLaunch.current = null
				setLaunching(false)
				setOpening(null)
			}
		}
	}

	return {
		pending,
		revision,
		launch, launching, opening,
		isLaunching: () => activeLaunch.current !== null,
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
