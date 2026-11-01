// Project requests and validation of the summaries returned by the backend.
// Rows and their writes belong to useProjectQuery; this module has no React state.
import { z } from "zod"
import { parsePayload, type DesktopApiClient } from "../api/client"

// The backend owns
// status precedence; "opening" and "deleting" exist only as local overview marks.
const ProjectSummaryStatus = z.enum(["running", "awaiting_user_input", "cancelling", "syncing", "dormant"])
export type ProjectSummaryStatus = z.infer<typeof ProjectSummaryStatus>
const identifier = z.string().refine(text => text.trim() !== "")
const Created = z.object({ slug: identifier })
const Project = Created.extend({
	status: ProjectSummaryStatus,
	run_id: identifier.nullish(),
	created_at: z.number().nullish(),
// createdAt is seconds since the epoch, or null when the backend does not know.
}).transform(({ slug, status, run_id: runId, created_at: createdAt }) => ({
	slug, status, runId: runId ?? null, createdAt: createdAt ?? null,
}))
export type Project = z.infer<typeof Project>
const Projects = z.array(Project).refine(projects => new Set(projects.map(project => project.slug)).size === projects.length)
const Acknowledgement = z.object({ ok: z.boolean() })

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
	parse(z.object({ ok: z.literal(true) }), await client.request(projectPath(slug), { method: "DELETE", signal }))
}
