import { useCallback, useEffect, useRef, useState } from "react"
import type { DesktopApiClient } from "../api/client"
import { useRequest } from "../api/useRequest"
import { createProject as requestProjectCreation, listProjects, type Project } from "./projects-api"
import { useProjectDeletion } from "./useProjectDeletion"

export interface ProjectRemoval {
	slug: string
	focus: string
}

export interface ProjectManagement {
	projects: Project[]
	name: string
	loading: boolean
	loadError: string
	creating: boolean
	canCreate: boolean
	createError: string
	deleting: ReadonlySet<string>
	deleteError: string
	removed: ProjectRemoval | null
	changeName: (name: string) => void
	refresh: () => void
	createProject: () => void
	canDelete: (slug: string) => boolean
	deleteProject: (slug: string) => void
	isDeleting: (slug: string) => boolean
}

interface ProjectManagementOptions {
	onCreated: (slug: string) => void
	onDeleted?: (removal: ProjectRemoval) => void
	onListed: (projects: Project[]) => void
	hasLocalWork: (slug: string) => boolean
	pollInBackground: boolean
	pollInterval: number
}

/** Manage the project collection; workspace selection and execution live outside this owner. */
export function useProjectManagement(
	client: DesktopApiClient | null,
	visible: boolean,
	connected: boolean,
	options: ProjectManagementOptions,
): ProjectManagement {
	const [projects, setProjects] = useState<Project[]>([])
	const [name, setName] = useState("")
	const [removed, setRemoved] = useState<ProjectRemoval | null>(null)
	const hasLoaded = useRef(false)
	const listing = useRequest({ preserveErrorWhilePending: true })
	const creation = useRequest()
	const deletion = useProjectDeletion(client)
	const { run: readProjects, cancel: cancelListing } = listing
	const { reconcile, pending: deleting } = deletion

	// Accepted async results use the current rows/callbacks, not their request's render.
	const latest = useRef({ projects, options })
	latest.current = { projects, options }

	const finishDeletion = useCallback((slug: string): void => {
		const rows = latest.current.projects
		const index = rows.findIndex(row => row.slug === slug)
		const nextProject = rows[index + 1] ?? rows[index - 1]
		const removal = { slug, focus: nextProject?.slug ?? "" }

		setRemoved(removal)
		setProjects(current => current.filter(row => row.slug !== slug))
		latest.current.options.onDeleted?.(removal)
	}, [])

	const load = useCallback((): Promise<void> | undefined => {
		if (!client || !connected) return

		return readProjects(signal => listProjects(client, signal), listed => {
			const result = reconcile(listed, latest.current.projects)
			for (const slug of result.deleted) finishDeletion(slug)
			setProjects(result.projects)
			latest.current.options.onListed(result.projects)
			hasLoaded.current = true
		})
	}, [client, connected, readProjects, reconcile, finishDeletion])

	const refresh = useCallback((): Promise<void> | undefined => {
		cancelListing()
		return load()
	}, [cancelListing, load])

	const { pollInBackground, pollInterval } = options
	useEffect(() => {
		const needsPolling = visible || pollInBackground || deleting.size > 0
		const needsFirstLoad = !hasLoaded.current
		if (!client || !connected || (!needsFirstLoad && !needsPolling)) {
			return cancelListing
		}

		let active = true
		let timer: ReturnType<typeof setTimeout> | undefined

		async function poll(): Promise<void> {
			await load()
			if (active && needsPolling) {
				timer = setTimeout(() => { void poll() }, pollInterval)
			}
		}
		void poll()

		return () => {
			active = false
			clearTimeout(timer)
			cancelListing()
		}
	}, [visible, client, connected, pollInBackground, pollInterval, deleting.size, load, cancelListing])

	const wasConnected = useRef(connected)
	useEffect(() => {
		if (connected && !wasConnected.current && !visible) void refresh()
		wasConnected.current = connected
	}, [connected, visible, refresh])

	function canDelete(slug: string): boolean {
		if (!client || !connected || listing.error || creation.pending) return false
		if (options.hasLocalWork(slug) || deletion.isDeleting(slug)) return false

		const project = projects.find(row => row.slug === slug)
		return project?.status === "dormant" && project.runId === null
	}

	async function deleteProject(slug: string): Promise<void> {
		if (!canDelete(slug)) return

		// A read begun before DELETE cannot establish its outcome.
		cancelListing()
		const result = await deletion.deleteProject(slug)
		if (result === "ignored") return
		if (result === "deleted") finishDeletion(slug)

		// Uncertain results require a fresh listing; never automatically repeat DELETE.
		void refresh()
	}

	function createProject(): void {
		const projectName = name.trim()
		if (!client || !connected || !projectName) return
		// The backend chooses the slug; wait before potentially recreating a deleted project.
		if (deletion.hasPendingDeletion()) return

		void creation.run(signal => requestProjectCreation(client, projectName, signal), project => {
			deletion.forgetDeletion(project.slug)
			latest.current.options.onCreated(project.slug)
			setName("")
			void refresh()
		})
	}

	return {
		projects,
		name,
		loading: listing.pending && !hasLoaded.current,
		loadError: listing.error,
		creating: creation.pending,
		canCreate: Boolean(client && connected && name.trim()) && !creation.pending && deleting.size === 0,
		createError: creation.error,
		deleting,
		deleteError: deletion.error,
		removed,
		changeName: setName,
		refresh,
		createProject,
		canDelete,
		deleteProject: slug => { void deleteProject(slug) },
		isDeleting: deletion.isDeleting,
	}
}
