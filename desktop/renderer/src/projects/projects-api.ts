// Project requests and validation of the slug returned by the backend.
// Collection management and workspace selection live in their feature owners; no React state here.
import { ApiError, type DesktopApiClient } from "../api/client"

// Minimal contract adapted from web/lib/robozium/{client,wire}.ts; see the PR 7 plan.
const statuses = ["running", "awaiting_user_input", "cancelling", "syncing", "dormant"] as const
export type ProjectStatus = typeof statuses[number]
export interface Project { slug: string; status: ProjectStatus; runId: string | null }
export function canCancelProject(project: Project): boolean {
	return project.status === "running" || project.status === "awaiting_user_input" || project.status === "syncing"
}

function malformed(): never {
	throw new ApiError("malformed", "The backend returned an invalid selection response.")
}

function parseSlug(value: unknown): string {
	if (!value || typeof value !== "object" || Array.isArray(value)) malformed()
	if (!("slug" in value) || typeof value.slug !== "string" || !value.slug.trim()) malformed()
	return value.slug
}

export async function listProjects(client: DesktopApiClient, signal: AbortSignal): Promise<Project[]> {
	const value = await client.request("/projects", { signal })
	if (!Array.isArray(value)) malformed()
	const projects = value.map((item): Project => {
		const slug = parseSlug(item)
		if (!item || typeof item !== "object" || !("status" in item) || !statuses.includes(item.status as ProjectStatus)
			|| !("run_id" in item) || !(item.run_id === null || typeof item.run_id === "string" && item.run_id.trim())) malformed()
		return { slug, status: item.status as ProjectStatus, runId: item.run_id }
	})
	const slugs = new Set(projects.map(project => project.slug))
	if (slugs.size !== projects.length) malformed()
	return projects
}

export async function createProject(client: DesktopApiClient, name: string, signal: AbortSignal): Promise<{ slug: string }> {
	const value = await client.request("/projects", { method: "POST", json: { name }, signal })
	return { slug: parseSlug(value) }
}

export async function cancelProject(client: DesktopApiClient, slug: string, signal: AbortSignal): Promise<boolean> {
	const value = await client.request(`/projects/${encodeURIComponent(slug)}/cancel`, { method: "POST", signal })
	if (!value || typeof value !== "object" || !("ok" in value) || typeof value.ok !== "boolean") malformed()
	return value.ok
}

export async function deleteProject(client: DesktopApiClient, slug: string, signal: AbortSignal): Promise<void> {
	const value = await client.request(`/projects/${encodeURIComponent(slug)}`, { method: "DELETE", signal })
	if (!value || typeof value !== "object" || !("ok" in value) || value.ok !== true) {
		throw new ApiError("malformed", "The backend did not acknowledge deletion.")
	}
}
