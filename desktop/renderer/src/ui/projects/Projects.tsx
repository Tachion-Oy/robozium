import { canCancelProject } from "../../projects/projects-api"
import type { ProjectsState } from "../../projects/useProjects"
import { HudButton } from "../HudButton"
import "./projects.css"

export function Projects({ state, connected = true }: { state: ProjectsState; connected?: boolean }) {
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
				<HudButton aria-pressed={state.selected === project.slug} onClick={() => state.select(project.slug)}>
					{project.slug}{state.selected === project.slug && <span aria-hidden="true"> ●</span>}
				</HudButton>
				<span role="status">{state.cancelling.has(project.slug) ? "Cancelling…" : project.status.replaceAll("_", " ")}</span>
				<HudButton aria-label={`Cancel ${project.slug}`} variant="warning"
					disabled={!connected || state.cancelling.has(project.slug) || !canCancelProject(project)} onClick={() => state.cancelProject(project.slug)}>Cancel</HudButton>
			</li>)}
		</ul>
		<form onSubmit={event => { event.preventDefault(); state.create() }}>
			<label htmlFor="project-name">Project name</label>
			<input id="project-name" value={state.name} readOnly={state.creating}
				onChange={event => state.changeName(event.target.value)} />
			<HudButton type="submit" variant="success" aria-disabled={state.creating || !state.name.trim()}>Create project</HudButton>
		</form>
		<p role="status">{state.creating ? "Creating project…" : ""}</p>
		{state.createError && <p role="alert">Could not create project: {state.createError}</p>}
	</section>
}
