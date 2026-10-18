// Own project rows, local selection and the creation draft across view changes.
// Read/write lifetimes use the shared request hook; HTTP contracts stay in projects-api.
import { useCallback, useEffect, useRef, useState } from "react"
import { ApiError, type DesktopApiClient } from "../api/client"
import { cancelProject, canCancelProject, createProject, deleteProject, listProjects, type Project } from "./projects-api"
import { withDeadline } from "../api/request"
import { useRequest } from "../api/useRequest"

export interface ProjectsState {
	deleting: ReadonlySet<string>
	removed: { slug: string; focus: string } | null
	canDelete: (slug: string) => boolean
	deleteProject: (slug: string) => void
	cancelling: ReadonlySet<string>
	actionError: string
	cancelProject: (slug: string, active?: boolean) => void
	projects: Project[]
	selected: string
	name: string
	loading: boolean
	creating: boolean
	loadError: string
	createError: string
	select: (slug: string) => void
	changeName: (name: string) => void
	refresh: () => void
	create: () => void
}

export function useProjects(client: DesktopApiClient | null, visible: boolean, connected = true, options: { onDeleted?: (slug: string) => void; busyProject?: string; initialSelected?: string } = {}): ProjectsState {
	const [projects, setProjects] = useState<Project[]>([])
	const [selected, setSelected] = useState(options.initialSelected ?? "")
	const loaded = useRef(false)
	const [name, setName] = useState("")
	const [cancelling, setCancelling] = useState<ReadonlySet<string>>(new Set())
	const pendingCancels = useRef(new Set<string>())
	const operations = useRef(new Map<string, AbortController>())
	const [deleting, setDeleting] = useState<ReadonlySet<string>>(new Set())
	const pendingDeletes = useRef(new Set<string>())
	const removedSlugs = useRef(new Set<string>())
	const [removed, setRemoved] = useState<{ slug: string; focus: string } | null>(null)
	const latest = useRef({ projects, options })
	latest.current = { projects, options }
	const finishDeletion = useCallback((slug: string) => {
		if (removedSlugs.current.has(slug)) return
		removedSlugs.current.add(slug)
		pendingDeletes.current.delete(slug)
		const rows = latest.current.projects
		const index = rows.findIndex(row => row.slug === slug)
		setRemoved({ slug, focus: rows[index + 1]?.slug ?? rows[index - 1]?.slug ?? "" })
		setSelected(current => current === slug ? "" : current)
		setProjects(current => current.filter(row => row.slug !== slug))
		setDeleting(new Set(pendingDeletes.current))
		latest.current.options.onDeleted?.(slug)
	}, [])
	const [actionError, setActionError] = useState("")
	const read = useRequest(true)
	const write = useRequest()
	const { run, cancel } = read
	const load = useCallback(() => {
		if (!client || !connected) return
		return run(signal => listProjects(client, signal), rows => {
			for (const slug of pendingDeletes.current) {
				if (operations.current.has(slug)) {
					const previous = latest.current.projects.find(row => row.slug === slug)
					if (previous && !rows.some(row => row.slug === slug)) rows.push(previous)
				} else if (!rows.some(row => row.slug === slug)) finishDeletion(slug)
				else pendingDeletes.current.delete(slug)
			}
			setDeleting(new Set(pendingDeletes.current))
			const confirmed = rows.filter(row => !removedSlugs.current.has(row.slug))
			setProjects(confirmed)
			setSelected(current => confirmed.some(row => row.slug === current) ? current : "")
			loaded.current = true
			for (const slug of pendingCancels.current) {
				if (!operations.current.has(slug) && !rows.some(row => row.slug === slug && row.status !== "dormant")) pendingCancels.current.delete(slug)
			}
			setCancelling(new Set(pendingCancels.current))
		})
	}, [client, connected, run, finishDeletion])
	const refresh = useCallback(() => { cancel(); return load() }, [cancel, load])
	useEffect(() => {
		if (!client || !connected || !visible && loaded.current && cancelling.size === 0 && deleting.size === 0) return cancel
		let active = true
		let timer: ReturnType<typeof setTimeout> | undefined
		const poll = async () => {
			await load()
			if (active && (visible || pendingCancels.current.size || pendingDeletes.current.size)) timer = setTimeout(() => { void poll() }, pendingCancels.current.size ? 250 : 3000)
		}
		void poll()
		return () => { active = false; clearTimeout(timer); cancel() }
	}, [visible, client, connected, cancelling.size, deleting.size, load, cancel])
	useEffect(() => {
		const requests = operations.current
		return () => { for (const request of requests.values()) request.abort(); requests.clear() }
	}, [client])
	const wasConnected = useRef(connected)
	useEffect(() => {
		if (connected && !wasConnected.current && !visible) void refresh()
		wasConnected.current = connected
	}, [connected, visible, refresh])
	const cancelWork = async (slug: string, active = false) => {
		const project = projects.find(row => row.slug === slug)
		if (!client || !connected || operations.current.has(slug) || pendingDeletes.current.has(slug) || pendingCancels.current.has(slug) || !(active || project && canCancelProject(project))) return
		const controller = new AbortController()
		operations.current.set(slug, controller)
		pendingCancels.current.add(slug)
		setCancelling(new Set(pendingCancels.current))
		setActionError("")
		try {
			await withDeadline(controller.signal, signal => cancelProject(client, slug, signal))
		} catch (error) {
			if (!controller.signal.aborted) {
				setActionError(`${slug}: ${error instanceof Error ? error.message : "Cancellation failed."}`)
				pendingCancels.current.delete(slug)
			}
		} finally {
			if (operations.current.get(slug) === controller) {
				operations.current.delete(slug)
				setCancelling(new Set(pendingCancels.current))
				void refresh()
			}
		}
	}
	const canDelete = (slug: string) => connected && !read.error && !write.pending && options.busyProject !== slug && !pendingDeletes.current.has(slug)
		&& !operations.current.has(slug) && !pendingCancels.current.has(slug) && projects.some(row => row.slug === slug && row.status === "dormant")
	const remove = async (slug: string) => {
		if (!client || !canDelete(slug)) return
		const controller = new AbortController()
		operations.current.set(slug, controller)
		pendingDeletes.current.add(slug)
		setDeleting(new Set(pendingDeletes.current))
		setActionError("")
		cancel() // A read begun before DELETE cannot reconcile its outcome.
		try {
			await withDeadline(controller.signal, signal => deleteProject(client, slug, signal))
			if (!controller.signal.aborted) finishDeletion(slug)
		} catch (error) {
			if (!controller.signal.aborted) setActionError(`${slug}: ${error instanceof ApiError && error.status === 409
				? "Deletion blocked: active work must finish before deleting."
				: error instanceof Error ? error.message : "Deletion failed."}`)
		} finally {
			if (operations.current.get(slug) === controller) {
				operations.current.delete(slug)
				void refresh() // Uncertain results reconcile by confirmed presence/absence; never retry DELETE.
			}
		}
	}
	const create = () => {
		if (!client || !connected || !name.trim()) return
		void write.run(signal => createProject(client, name.trim(), signal), project => {
			removedSlugs.current.delete(project.slug)
			setSelected(project.slug)
			setName("")
			refresh()
		})
	}
	return { deleting, removed, canDelete, deleteProject: slug => { void remove(slug) }, cancelling, actionError, cancelProject: (slug, active) => { void cancelWork(slug, active) }, projects, selected, name, select: setSelected, changeName: setName, refresh, create,
		loading: read.pending, creating: write.pending, loadError: read.error, createError: write.error }
}
