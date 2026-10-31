// Project requests and validation of the summaries returned by the backend.
// Rows and their writes belong to useProjectQuery; this module has no React state.
import { ApiError, type DesktopApiClient } from "../api/client"

// The backend owns
// status precedence; "opening" and "deleting" exist only as local overview marks.
export const ProjectSummaryStatus = ["running", "awaiting_user_input", "cancelling", "syncing", "dormant"] as const
export type ProjectSummaryStatus = typeof ProjectSummaryStatus[number]
export interface Project {
	slug: string
	status: ProjectSummaryStatus
	runId: string | null
	/** Seconds since the epoch, or null when the backend does not know. */
	createdAt: number | null
}

function malformed(): never {
	throw new ApiError("malformed", "The backend returned an invalid selection response.")
}

function readSlug(value: unknown): string {
	if (!value || typeof value !== "object" || Array.isArray(value)) malformed()
	if (!("slug" in value) || typeof value.slug !== "string" || !value.slug.trim()) malformed()
	return value.slug
}

function parseProject(value: unknown): Project {
	const slug = readSlug(value)
	const summary = value as Record<string, unknown>
	const status = summary.status
	if (!ProjectSummaryStatus.some(known => known === status)) malformed()
	const runId = summary.run_id ?? null
	if (runId !== null && (typeof runId !== "string" || !runId.trim())) malformed()
	const createdAt = summary.created_at ?? null
	if (createdAt !== null && (typeof createdAt !== "number" || !Number.isFinite(createdAt))) malformed()
	return { slug, status: status as ProjectSummaryStatus, runId, createdAt }
}

export async function listProjects(client: DesktopApiClient, signal: AbortSignal): Promise<Project[]> {
	const value = await client.request("/projects", { signal })
	if (!Array.isArray(value)) malformed()
	const projects = value.map(parseProject)
	const slugs = new Set(projects.map(project => project.slug))
	if (slugs.size !== projects.length) malformed()
	return projects
}

/** Creation answers with the backend-chosen slug only. */
export async function createProject(client: DesktopApiClient, name: string, signal: AbortSignal): Promise<string> {
	return readSlug(await client.request("/projects", { method: "POST", json: { name }, signal }))
}

function readAcknowledgement(value: unknown): boolean {
	if (!value || typeof value !== "object" || !("ok" in value) || typeof value.ok !== "boolean") malformed()
	return value.ok
}

const projectPath = (slug: string) => `/projects/${encodeURIComponent(slug)}`

/** False means the backend refused because the project has nothing to cancel. */
export async function cancelProject(client: DesktopApiClient, slug: string, signal: AbortSignal): Promise<boolean> {
	return readAcknowledgement(await client.request(`${projectPath(slug)}/cancel`, { method: "POST", signal }))
}

export async function deleteProject(client: DesktopApiClient, slug: string, signal: AbortSignal): Promise<void> {
	if (!readAcknowledgement(await client.request(projectPath(slug), { method: "DELETE", signal }))) malformed()
}
