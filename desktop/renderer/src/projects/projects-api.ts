// Project requests and validation of the slug returned by the backend.
// Selection and creation drafts belong to useProjects; this module has no React state.
import { ApiError, type DesktopApiClient } from "../api/client"

// Minimal contract adapted from web/lib/robozium/{client,wire}.ts; see the PR 7 plan.
export interface Project { slug: string }

function malformed(): never {
	throw new ApiError("malformed", "The backend returned an invalid selection response.")
}

function parseProject(value: unknown): Project {
	if (!value || typeof value !== "object" || Array.isArray(value)) malformed()
	if (!("slug" in value) || typeof value.slug !== "string" || !value.slug.trim()) malformed()
	return { slug: value.slug }
}

export async function listProjects(client: DesktopApiClient, signal: AbortSignal): Promise<Project[]> {
	const value = await client.request("/projects", { signal })
	if (!Array.isArray(value)) malformed()
	const projects = value.map(parseProject)
	const slugs = new Set(projects.map(project => project.slug))
	if (slugs.size !== projects.length) malformed()
	return projects
}

export async function createProject(client: DesktopApiClient, name: string, signal: AbortSignal): Promise<Project> {
	const value = await client.request("/projects", { method: "POST", json: { name }, signal })
	return parseProject(value)
}
