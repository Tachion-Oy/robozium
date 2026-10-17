import { useCallback, useEffect, useRef, useState } from "react"
import type { DesktopApiClient } from "./client"
import { createProject, getModelSelection, listProjects, selectModel, type ModelSelection, type Project } from "./selection"

/** One request at a time, with explicit cancellation and no automatic write retries. */
function useRequest() {
	const activeRequest = useRef<AbortController | null>(null)
	const [pending, setPending] = useState(false)
	const [error, setError] = useState("")
	const cancel = useCallback(() => {
		activeRequest.current?.abort()
		activeRequest.current = null
		setPending(false)
	}, [])
	useEffect(() => cancel, [cancel])
	const run = useCallback(async <T,>(request: (signal: AbortSignal) => Promise<T>, accept: (value: T) => void) => {
		if (activeRequest.current) return
		const controller = new AbortController()
		activeRequest.current = controller
		setPending(true)
		setError("")
		const deadline = setTimeout(() => controller.abort(), 10_000)
		try {
			const value = await request(controller.signal)
			if (activeRequest.current === controller) accept(value)
		} catch (failure) {
			if (activeRequest.current === controller) setError(controller.signal.aborted
				? "Request timed out. Check the backend before trying again."
				: failure instanceof Error ? failure.message : "Request failed.")
		} finally {
			clearTimeout(deadline)
			if (activeRequest.current === controller) { activeRequest.current = null; setPending(false) }
		}
	}, [])
	return { run, cancel, pending, error }
}

export interface ProjectsState {
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

export function useProjects(client: DesktopApiClient | null, visible: boolean): ProjectsState {
	const [projects, setProjects] = useState<Project[]>([])
	const [selected, setSelected] = useState("")
	const [name, setName] = useState("")
	const read = useRequest()
	const write = useRequest()
	const { run, cancel } = read
	const refresh = useCallback(() => {
		if (!client) return
		cancel()
		void run(signal => listProjects(client, signal), setProjects)
	}, [client, cancel, run])
	useEffect(() => {
		if (visible) refresh()
		return cancel
	}, [visible, refresh, cancel])
	const create = () => {
		if (!client || !name.trim()) return
		void write.run(signal => createProject(client, name.trim(), signal), project => {
			setSelected(project.slug)
			setName("")
			refresh()
		})
	}
	return { projects, selected, name, select: setSelected, changeName: setName, refresh, create,
		loading: read.pending, creating: write.pending, loadError: read.error, createError: write.error }
}

export function useModels(client: DesktopApiClient | null, connected: boolean) {
	const [selection, setSelection] = useState<ModelSelection>()
	const [retryModel, setRetryModel] = useState<string | null>(null)
	const request = useRequest()
	const { run, cancel } = request
	const confirm = useCallback((value: ModelSelection) => {
		setSelection(value)
		setRetryModel(null)
	}, [])
	const refresh = useCallback(() => {
		if (client && connected) void run(signal => getModelSelection(client, signal), confirm)
	}, [client, connected, run, confirm])
	// Revalidate server state on recovery; keep the mounted application's local state.
	useEffect(() => {
		refresh()
		return cancel
	}, [refresh, cancel])
	const choose = (model: string) => {
		if (!client || !connected || request.pending) return
		// A failed request can leave the displayed selection out of sync with the backend.
		if (model === selection?.selected_model_id && retryModel === null && !request.error) return
		void run(signal => {
			setRetryModel(model)
			return selectModel(client, model, signal)
		}, confirm)
	}
	return { selection, pending: request.pending, error: request.error, choose, refresh,
		canRetry: connected && !request.pending && retryModel !== null,
		retry: () => { if (retryModel !== null) choose(retryModel) } }
}
