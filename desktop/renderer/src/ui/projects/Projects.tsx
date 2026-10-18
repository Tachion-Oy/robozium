import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { canCancelProject } from "../../projects/projects-api"
import type { ProjectsState } from "../../projects/useProjects"
import { HudButton } from "../HudButton"
import "./projects.css"

export function Projects({ state, connected = true }: { state: ProjectsState; connected?: boolean }) {
	const [armed, setArmed] = useState<{ slug: string; status: string; runId: string | null } | null>(null)
	const buttons = useRef(new Map<string, HTMLButtonElement>())
	const nameInput = useRef<HTMLInputElement>(null)
	const lastRemoval = useRef(state.removed)
	useEffect(() => {
		if (armed && !state.projects.some(row => row.slug === armed.slug && row.status === armed.status && row.runId === armed.runId && state.canDelete(row.slug))) setArmed(null)
	}, [state, armed])
	useLayoutEffect(() => {
		// Consume new removals while visible; revisiting the view must not steal focus.
		if (state.removed && state.removed !== lastRemoval.current) {
			(buttons.current.get(state.removed.focus) ?? nameInput.current)?.focus()
		}
		lastRemoval.current = state.removed
	}, [state.removed])
	return <section className="projects" aria-labelledby="projects-heading">
		<h2 id="projects-heading">Runs Overview</h2>
		<div className="projects__toolbar">
			<p role="status" title={state.selected || undefined}>Selected project: {state.selected || "None"}</p>
			<HudButton onClick={state.refresh}>Refresh</HudButton>
		</div>
		<p role="status">{state.loading ? "Loading projects…" : !state.loadError && !state.projects.length ? "No projects yet." : ""}</p>
		{state.loadError && <p role="alert">Could not refresh projects: {state.loadError}</p>}
		{state.actionError && <p role="alert">{state.actionError}</p>}
		<ul aria-label="Projects">
			{state.projects.map(project => <li key={project.slug}>
				<HudButton ref={button => { if (button) buttons.current.set(project.slug, button); else buttons.current.delete(project.slug) }} aria-pressed={state.selected === project.slug} onClick={() => state.select(project.slug)}>
					{project.slug}{state.selected === project.slug && <span aria-hidden="true"> ●</span>}
				</HudButton>
				<span role="status">{state.deleting.has(project.slug) ? "Deleting…" : state.cancelling.has(project.slug) ? "Cancelling…" : project.status.replaceAll("_", " ")}</span>
				<HudButton aria-label={`Cancel ${project.slug}`} variant="warning"
					disabled={!connected || state.deleting.has(project.slug) || state.cancelling.has(project.slug) || !canCancelProject(project)} onClick={() => state.cancelProject(project.slug)}>Cancel</HudButton>
				<HudButton variant="danger" disabled={!state.canDelete(project.slug)}
					aria-label={`${state.deleting.has(project.slug) ? "Deleting" : armed?.slug === project.slug ? "Confirm delete" : "Delete"} ${project.slug}`}
					onBlur={() => setArmed(null)} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setArmed(null) } }}
					onClick={() => {
						if (!state.canDelete(project.slug)) return
						if (armed?.slug === project.slug) { setArmed(null); state.deleteProject(project.slug) }
						else setArmed({ slug: project.slug, status: project.status, runId: project.runId })
					}}>{state.deleting.has(project.slug) ? "Deleting…" : armed?.slug === project.slug ? "Confirm delete" : "Delete"}</HudButton>
			</li>)}
		</ul>
		<form onSubmit={event => { event.preventDefault(); state.create() }}>
			<label htmlFor="project-name">Project name</label>
			<input ref={nameInput} id="project-name" value={state.name} readOnly={state.creating}
				onChange={event => state.changeName(event.target.value)} />
			<HudButton type="submit" variant="success" aria-disabled={!state.canCreate}>Create project</HudButton>
		</form>
		<p role="status">{state.creating ? "Creating project…" : ""}</p>
		{state.createError && <p role="alert">Could not create project: {state.createError}</p>}
	</section>
}
