import { useCallback, useEffect, useRef, useState } from "react"
import type { DesktopApiClient } from "./client"
import { createProject, getModelSelection, listProjects, selectModel, type ModelSelection, type Project } from "./selection"

/** One request at a time, with explicit cancellation and no automatic write retries. */
function useRequest() {
	const current = useRef<AbortController | null>(null)
	const [pending, setPending] = useState(false)
	const [error, setError] = useState("")
	const cancel = useCallback(() => {
		current.current?.abort()
		current.current = null
	}, [])
	useEffect(() => cancel, [cancel])
	const run = useCallback(async <T,>(request: (signal: AbortSignal) => Promise<T>, accept: (value: T) => void) => {
		if (current.current) return
		const controller = new AbortController()
		current.current = controller
		setPending(true)
		setError("")
		const deadline = setTimeout(() => controller.abort(), 10_000)
		try {
			const value = await request(controller.signal)
			if (current.current === controller) accept(value)
		} catch (failure) {
			if (current.current === controller) setError(controller.signal.aborted
				? "Request timed out. Check the backend before trying again."
				: failure instanceof Error ? failure.message : "Request failed.")
		} finally {
			clearTimeout(deadline)
			if (current.current === controller) { current.current = null; setPending(false) }
		}
	}, [])
	return { run, cancel, pending, error }
}

export function useProjects(client: DesktopApiClient | null, visible: boolean) {
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
	return { projects, selected, setSelected, name, setName, read, write, refresh, create }
}

export function useModels(client: DesktopApiClient | null) {
	const [selection, setSelection] = useState<ModelSelection>()
	const request = useRequest()
	const { run, cancel } = request
	const retryModel = useRef<string | null>(null)
	const load = useCallback(() => {
		if (client) void run(signal => getModelSelection(client, signal), setSelection)
	}, [client, run])
	useEffect(() => { load(); return cancel }, [load, cancel])
	const choose = (model: string) => {
		if (!client || request.pending || model === selection?.selected_model_id) return
		void run(signal => {
			retryModel.current = model
			return selectModel(client, model, signal)
		}, value => { retryModel.current = null; setSelection(value) })
	}
	return { selection, ...request, choose, retry: () => retryModel.current === null ? load() : choose(retryModel.current) }
}
