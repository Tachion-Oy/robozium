import { useCallback, useEffect, useRef, useState } from "react"
import type { DesktopApiClient } from "../api/client"
import { useRequest } from "../api/useRequest"
import { canCancelProject, createProject, listProjects, type Project } from "./projects-api"
import { useProjectMutations } from "./useProjectMutations"

interface ProjectRemoval {
	slug: string
	focus: string
}

export interface ProjectsState {
	projects: Project[]
	selected: string
	name: string
	loading: boolean
	loadError: string
	creating: boolean
	canCreate: boolean
	createError: string
	cancelling: ReadonlySet<string>
	deleting: ReadonlySet<string>
	actionError: string
	removed: ProjectRemoval | null
	select: (slug: string) => void
	changeName: (name: string) => void
	refresh: () => void
	create: () => void
	cancelProject: (slug: string, hasActiveRun?: boolean) => void
	canDelete: (slug: string) => boolean
	deleteProject: (slug: string) => void
}

interface ProjectsOptions {
	onDeleted?: (slug: string) => void
	onCancelled?: (slug: string) => void
	busyProjects?: readonly string[]
	initialSelected?: string
}

const PROJECT_POLL_INTERVAL = 3000
const CANCELLATION_POLL_INTERVAL = 250

/** Own project selection, listing and creation across view changes. */
export function useProjects(
	client: DesktopApiClient | null,
	visible: boolean,
	connected = true,
	options: ProjectsOptions = {},
): ProjectsState {
	const [projects, setProjects] = useState<Project[]>([])
	const [selected, setSelected] = useState(options.initialSelected ?? "")
	const [name, setName] = useState("")
	const [removed, setRemoved] = useState<ProjectRemoval | null>(null)
	const hasLoaded = useRef(false)
	const listing = useRequest({ preserveErrorWhilePending: true })
	const creation = useRequest()
	const mutations = useProjectMutations(client)
	const { run: readProjects, cancel: cancelListing } = listing
	const { reconcile, cancelling, deleting } = mutations

	// Accepted async results use the current rows/callbacks, not their request's render.
	const latest = useRef({ projects, options })
	latest.current = { projects, options }

	const finishDeletion = useCallback((slug: string): void => {
		const rows = latest.current.projects
		const index = rows.findIndex(row => row.slug === slug)
		const nextProject = rows[index + 1] ?? rows[index - 1]

		setRemoved({ slug, focus: nextProject?.slug ?? "" })
		setSelected(current => current === slug ? "" : current)
		setProjects(current => current.filter(row => row.slug !== slug))
		latest.current.options.onDeleted?.(slug)
	}, [])

	const load = useCallback((): Promise<void> | undefined => {
		if (!client || !connected) return

		return readProjects(signal => listProjects(client, signal), listed => {
			const result = reconcile(listed, latest.current.projects)
			for (const slug of result.deleted) finishDeletion(slug)
			for (const slug of result.cancelled) latest.current.options.onCancelled?.(slug)

			setProjects(result.rows)
			setSelected(current => result.rows.some(row => row.slug === current) ? current : "")
			hasLoaded.current = true
		})
	}, [client, connected, readProjects, reconcile, finishDeletion])

	const refresh = useCallback((): Promise<void> | undefined => {
		cancelListing()
		return load()
	}, [cancelListing, load])

	useEffect(() => {
		const needsPolling = visible || cancelling.size > 0 || deleting.size > 0
		const needsFirstLoad = !hasLoaded.current
		if (!client || !connected || (!needsFirstLoad && !needsPolling)) {
			return cancelListing
		}

		let active = true
		let timer: ReturnType<typeof setTimeout> | undefined
		const interval = cancelling.size > 0 ? CANCELLATION_POLL_INTERVAL : PROJECT_POLL_INTERVAL

		async function poll(): Promise<void> {
			await load()
			if (active && needsPolling) {
				timer = setTimeout(() => { void poll() }, interval)
			}
		}
		void poll()

		return () => {
			active = false
			clearTimeout(timer)
			cancelListing()
		}
	}, [visible, client, connected, cancelling.size, deleting.size, load, cancelListing])

	const wasConnected = useRef(connected)
	useEffect(() => {
		if (connected && !wasConnected.current && !visible) void refresh()
		wasConnected.current = connected
	}, [connected, visible, refresh])

	async function cancelWork(slug: string, hasActiveRun = false): Promise<void> {
		if (!client || !connected || mutations.hasOperation(slug)) return

		const project = projects.find(row => row.slug === slug)
		if (!hasActiveRun && (!project || !canCancelProject(project))) return

		const shouldRefresh = await mutations.cancel(slug)
		if (shouldRefresh) void refresh()
	}

	function canDelete(slug: string): boolean {
		if (!client || !connected || listing.error || creation.pending) return false
		if (options.busyProjects?.includes(slug) || mutations.hasOperation(slug)) return false

		const project = projects.find(row => row.slug === slug)
		return project?.status === "dormant" && project.runId === null
	}

	async function remove(slug: string): Promise<void> {
		if (!canDelete(slug)) return

		// A read begun before DELETE cannot establish its outcome.
		cancelListing()
		const result = await mutations.remove(slug)
		if (result === "ignored") return
		if (result === "deleted") finishDeletion(slug)

		// Uncertain results require a fresh listing; never automatically repeat DELETE.
		void refresh()
	}

	function create(): void {
		const projectName = name.trim()
		if (!client || !connected || !projectName) return
		// The backend chooses the slug; wait before potentially recreating a deleted project.
		if (mutations.hasPendingDeletion()) return

		void creation.run(signal => createProject(client, projectName, signal), project => {
			mutations.forgetDeletion(project.slug)
			setSelected(project.slug)
			setName("")
			void refresh()
		})
	}

	return {
		projects,
		selected,
		name,
		loading: listing.pending && !hasLoaded.current,
		loadError: listing.error,
		creating: creation.pending,
		canCreate: Boolean(client && connected && name.trim()) && !creation.pending && deleting.size === 0,
		createError: creation.error,
		cancelling,
		deleting,
		actionError: mutations.error,
		removed,
		select: setSelected,
		changeName: setName,
		refresh,
		create,
		cancelProject: (slug, hasActiveRun) => { void cancelWork(slug, hasActiveRun) },
		canDelete,
		deleteProject: slug => { void remove(slug) },
	}
}
