// Project requests and validation of the summaries returned by the backend.
// Rows and their writes belong to useProjectQuery; this module has no React state.
import { z } from "zod"
import { type DesktopApiClient } from "../api/client"
import { nonBlank, orNull, parsePayload } from "../api/payload"

// The backend owns status precedence; "opening" and "deleting" exist only as local overview marks.
const ProjectSummaryStatus = z.enum(["running", "awaiting_user_input", "cancelling", "syncing", "dormant"])
export type ProjectSummaryStatus = z.infer<typeof ProjectSummaryStatus>
export interface Project {
	slug: string
	status: ProjectSummaryStatus
	runId: string | null
	/** Seconds since the epoch, or null when the backend does not know. */
	createdAt: number | null
}

const Created = z.object({ slug: nonBlank })
const Projects: z.ZodType<Project[]> = z.array(Created.extend({
	status: ProjectSummaryStatus,
	run_id: orNull(nonBlank),
	created_at: orNull(z.number()),
}).transform(({ slug, status, run_id: runId, created_at: createdAt }) => ({ slug, status, runId, createdAt })))
	.refine(projects => new Set(projects.map(project => project.slug)).size === projects.length)
const Acknowledgement = z.object({ ok: z.boolean() })
const Deleted = z.object({ ok: z.literal(true) })

const parse = <T>(schema: z.ZodType<T>, value: unknown): T =>
	parsePayload(schema, value, "The backend returned an invalid selection response.")

export async function listProjects(client: DesktopApiClient, signal: AbortSignal): Promise<Project[]> {
	return parse(Projects, await client.request("/projects", { signal }))
}

/** Creation answers with the backend-chosen slug only. */
export async function createProject(client: DesktopApiClient, name: string, signal: AbortSignal): Promise<string> {
	return parse(Created, await client.request("/projects", { method: "POST", json: { name }, signal })).slug
}

const projectPath = (slug: string) => `/projects/${encodeURIComponent(slug)}`

/** False means the backend refused because the project has nothing to cancel. */
export async function cancelProject(client: DesktopApiClient, slug: string, signal: AbortSignal): Promise<boolean> {
	return parse(Acknowledgement, await client.request(`${projectPath(slug)}/cancel`, { method: "POST", signal })).ok
}

export async function deleteProject(client: DesktopApiClient, slug: string, signal: AbortSignal): Promise<void> {
	parse(Deleted, await client.request(projectPath(slug), { method: "DELETE", signal }))
}
