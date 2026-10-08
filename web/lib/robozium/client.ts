import type {
	CancelResponse,
	CapabilityView,
	CreateBody,
	CreateResponse,
	CredentialStatus,
	CredentialUnlockBody,
	DeleteProjectResponse,
	DependencyRecord,
	ModelSelectBody,
	ModelSelection,
	Project,
	ProjectCreateBody,
	ProjectCreateResponse,
	ReplyBody,
	ReplyResponse,
	RunView,
	TranscribeResponse,
} from "./wire"

export class AgentApiError extends Error {
	status: number

	constructor(status: number, message: string) {
		super(message)
		this.name = "AgentApiError"
		this.status = status
	}
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
	const response = await fetch(url, init)
	const data = (await response.json()) as T

	if (!response.ok) {
		const detail =
			typeof data === "object" &&
			data !== null &&
			"detail" in data &&
			typeof (data as { detail: unknown }).detail === "string"
				? (data as { detail: string }).detail
				: `Request failed (${response.status})`
		throw new AgentApiError(response.status, detail)
	}

	return data
}

export async function createRun(
	body: CreateBody,
	init?: { signal?: AbortSignal },
): Promise<CreateResponse> {
	return fetchJson<CreateResponse>("/api/runs/create", {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
		signal: init?.signal,
	})
}

export async function listProjects(init?: {
	signal?: AbortSignal
}): Promise<Project[]> {
	return fetchJson<Project[]>("/api/projects", {
		method: "GET",
		cache: "no-store",
		headers: {
			Accept: "application/json",
		},
		signal: init?.signal,
	})
}

export async function listCapabilities(init?: {
	signal?: AbortSignal
}): Promise<CapabilityView[]> {
	return fetchJson<CapabilityView[]>("/api/capabilities", {
		method: "GET",
		cache: "no-store",
		headers: { Accept: "application/json" },
		signal: init?.signal,
	})
}

export async function listDependencies(init?: {
	signal?: AbortSignal
}): Promise<DependencyRecord[]> {
	return fetchJson<DependencyRecord[]>("/api/admin/dependencies", {
		method: "GET",
		cache: "no-store",
		headers: {
			Accept: "application/json",
		},
		signal: init?.signal,
	})
}

export async function getCredentialStatus(init?: {
	signal?: AbortSignal
}): Promise<CredentialStatus> {
	return fetchJson<CredentialStatus>("/api/credentials", {
		method: "GET",
		cache: "no-store",
		headers: { Accept: "application/json" },
		signal: init?.signal,
	})
}

export async function unlockApiKeys(
	body: CredentialUnlockBody,
): Promise<CredentialStatus> {
	return fetchJson<CredentialStatus>("/api/credentials/unlock", {
		method: "POST",
		cache: "no-store",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	})
}

export async function clearApiKeys(): Promise<CredentialStatus> {
	return fetchJson<CredentialStatus>("/api/credentials/clear", {
		method: "POST",
		cache: "no-store",
		headers: { Accept: "application/json" },
	})
}

export async function getModelSelection(init?: {
	signal?: AbortSignal
	runId?: string | null
}): Promise<ModelSelection> {
	const query = init?.runId
		? `?run_id=${encodeURIComponent(init.runId)}`
		: ""
	return fetchJson<ModelSelection>(`/api/models${query}`, {
		method: "GET",
		cache: "no-store",
		headers: { Accept: "application/json" },
		signal: init?.signal,
	})
}

export async function selectModel(
	body: ModelSelectBody,
	init?: { signal?: AbortSignal },
): Promise<ModelSelection> {
	return fetchJson<ModelSelection>("/api/models", {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
		signal: init?.signal,
	})
}

export async function checkDependencies(init?: {
	signal?: AbortSignal
}): Promise<DependencyRecord[]> {
	return fetchJson<DependencyRecord[]>("/api/admin/dependencies", {
		method: "POST",
		cache: "no-store",
		headers: {
			Accept: "application/json",
		},
		signal: init?.signal,
	})
}

export async function createProject(
	body: ProjectCreateBody,
	init?: { signal?: AbortSignal },
): Promise<ProjectCreateResponse> {
	return fetchJson<ProjectCreateResponse>("/api/projects", {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
		signal: init?.signal,
	})
}

export async function fetchRunView(
	runId: string,
	init?: { signal?: AbortSignal },
): Promise<RunView> {
	return fetchJson<RunView>(`/api/runs/${encodeURIComponent(runId)}/view`, {
		method: "GET",
		cache: "no-store",
		headers: {
			Accept: "application/json",
		},
		signal: init?.signal,
	})
}

export async function submitReply(
	runId: string,
	body: ReplyBody,
	init?: { signal?: AbortSignal },
): Promise<ReplyResponse> {
	return fetchJson<ReplyResponse>(
		`/api/runs/${encodeURIComponent(runId)}/reply`,
		{
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
			signal: init?.signal,
		},
	)
}

export async function interruptRun(
	runId: string,
	init?: { signal?: AbortSignal },
): Promise<CancelResponse> {
	return fetchJson<CancelResponse>(
		`/api/runs/${encodeURIComponent(runId)}/interrupt`,
		{
			method: "POST",
			headers: {
				Accept: "application/json",
			},
			signal: init?.signal,
		},
	)
}

export async function deleteProject(
	slug: string,
	init?: { signal?: AbortSignal },
): Promise<DeleteProjectResponse> {
	return fetchJson<DeleteProjectResponse>(
		`/api/projects/${encodeURIComponent(slug)}`,
		{
			method: "DELETE",
			headers: {
				Accept: "application/json",
			},
			signal: init?.signal,
		},
	)
}

export async function cancelProject(
	slug: string,
	init?: { signal?: AbortSignal },
): Promise<CancelResponse> {
	return fetchJson<CancelResponse>(
		`/api/projects/${encodeURIComponent(slug)}/cancel`,
		{
			method: "POST",
			headers: {
				Accept: "application/json",
			},
			signal: init?.signal,
		},
	)
}

export async function transcribeAudio(
	audio: Blob,
	init?: { signal?: AbortSignal },
): Promise<TranscribeResponse> {
	const form = new FormData()
	// Filename carries the extension the backend uses to label the upload.
	form.append("file", audio, "recording.webm")
	// No Content-Type header: the browser sets the multipart boundary.
	return fetchJson<TranscribeResponse>("/api/transcribe", {
		method: "POST",
		headers: {
			Accept: "application/json",
		},
		body: form,
		signal: init?.signal,
	})
}
