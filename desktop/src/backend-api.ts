// The main process's requests to the backend API and validation of their answers.
// The controller decides when to make them; this module keeps no state between requests.
import { z } from "zod"

/** Each request's own limit, within the caller's signal. */
const REQUEST_TIMEOUT_MS = 5000

const Ready = z.object({ status: z.string() })
const Projects = z.array(z.object({ slug: z.string().min(1), status: z.string() }))
const Acknowledgement = z.object({ ok: z.boolean() })

export class BackendApi {
	private readonly baseUrl: string
	private readonly fetcher: typeof fetch

	constructor(baseUrl: string, fetcher: typeof fetch = fetch) {
		this.baseUrl = baseUrl
		this.fetcher = fetcher
	}

	/** Whether the API reports itself ready; any failure to answer counts as not ready. */
	async ready(signal: AbortSignal): Promise<boolean> {
		try {
			return Ready.parse(await this.request("/ready", "GET", signal, 2500)).status === "ready"
		} catch {
			signal.throwIfAborted()
			return false
		}
	}

	/** The slugs of projects with a run or its background work still active. */
	async activeProjects(signal: AbortSignal): Promise<string[]> {
		const projects = Projects.safeParse(await this.request("/projects", "GET", signal))
		if (!projects.success) throw new Error("The backend returned an invalid project list.")
		return projects.data.filter(project => project.status !== "dormant").map(project => project.slug)
	}

	/** Cancel the project's run and background work, as the HUD's Stop does. */
	async cancelProject(slug: string, signal: AbortSignal): Promise<void> {
		Acknowledgement.parse(await this.request(`/projects/${encodeURIComponent(slug)}/cancel`, "POST", signal))
	}

	private async request(route: string, method: "GET" | "POST", signal: AbortSignal, timeout = REQUEST_TIMEOUT_MS): Promise<unknown> {
		const response = await this.fetcher(`${this.baseUrl}${route}`, {
			method,
			// Node fetch sends Fetch Metadata too; identify these as the desktop's own requests.
			headers: { Origin: "robozium://app" },
			signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
		})
		if (!response.ok) {
			await response.body?.cancel()
			throw new Error(`${method} ${route} returned ${response.status}`)
		}
		return response.json()
	}
}
