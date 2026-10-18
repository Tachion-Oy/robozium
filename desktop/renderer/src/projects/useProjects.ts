// Own project rows, local selection and the creation draft across view changes.
// Read/write lifetimes use the shared request hook; HTTP contracts stay in projects-api.
import { useCallback, useEffect, useRef, useState } from "react"
import type { DesktopApiClient } from "../api/client"
import { cancelProject, canCancelProject, createProject, listProjects, type Project } from "./projects-api"
import { withDeadline } from "../api/request"
import { useRequest } from "../api/useRequest"

export interface ProjectsState {
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

export function useProjects(client: DesktopApiClient | null, visible: boolean, connected = true): ProjectsState {
	const [projects, setProjects] = useState<Project[]>([])
	const [selected, setSelected] = useState("")
	const [name, setName] = useState("")
	const [cancelling, setCancelling] = useState<ReadonlySet<string>>(new Set())
	const pendingCancels = useRef(new Set<string>())
	const operations = useRef(new Map<string, AbortController>())
	const [actionError, setActionError] = useState("")
	const read = useRequest(true)
	const write = useRequest()
	const { run, cancel } = read
	const load = useCallback(() => {
		if (!client || !connected) return
		return run(signal => listProjects(client, signal), rows => {
			setProjects(rows)
			for (const slug of pendingCancels.current) {
				if (!operations.current.has(slug) && !rows.some(row => row.slug === slug && row.status !== "dormant")) pendingCancels.current.delete(slug)
			}
			setCancelling(new Set(pendingCancels.current))
		})
	}, [client, connected, run])
	const refresh = useCallback(() => { cancel(); return load() }, [cancel, load])
	useEffect(() => {
		if (!client || !connected || !visible && cancelling.size === 0) return cancel
		let active = true
		let timer: ReturnType<typeof setTimeout> | undefined
		const poll = async () => {
			await load()
			if (active) timer = setTimeout(() => { void poll() }, pendingCancels.current.size ? 250 : 3000)
		}
		void poll()
		return () => { active = false; clearTimeout(timer); cancel() }
	}, [visible, client, connected, cancelling.size, load, cancel])
	useEffect(() => {
		const requests = operations.current
		return () => { for (const request of requests.values()) request.abort(); requests.clear() }
	}, [client])
	const cancelWork = async (slug: string, active = false) => {
		const project = projects.find(row => row.slug === slug)
		if (!client || !connected || operations.current.has(slug) || pendingCancels.current.has(slug) || !(active || project && canCancelProject(project))) return
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
	const create = () => {
		if (!client || !connected || !name.trim()) return
		void write.run(signal => createProject(client, name.trim(), signal), project => {
			setSelected(project.slug)
			setName("")
			refresh()
		})
	}
	return { cancelling, actionError, cancelProject: (slug, active) => { void cancelWork(slug, active) }, projects, selected, name, select: setSelected, changeName: setName, refresh, create,
		loading: read.pending, creating: write.pending, loadError: read.error, createError: write.error }
}
