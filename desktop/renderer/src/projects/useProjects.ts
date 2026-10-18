// Own project rows, local selection and the creation draft across view changes.
// Read/write lifetimes use the shared request hook; HTTP contracts stay in projects-api.
import { useCallback, useEffect, useState } from "react"
import type { DesktopApiClient } from "../api/client"
import { createProject, listProjects, type Project } from "./projects-api"
import { useRequest } from "../api/useRequest"

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
