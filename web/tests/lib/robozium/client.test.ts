import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
	cancelProject,
	checkDependencies,
	createProject,
	createRun,
	deleteProject,
	getModelSelection,
	getProjectCapabilitySelection,
	interruptRun,
	listDependencies,
	listCapabilities,
	listProjects,
	selectModel,
	saveProjectCapabilitySelection,
	transcribeAudio,
} from "../../../lib/robozium/client"
import type { CapabilitySelection, CreateResponse } from "../../../lib/robozium/wire"

const fetchMock = vi.fn<typeof fetch>()

function okJson<T>(payload: T, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	})
}

function errJson(payload: unknown, status: number): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	})
}

function expectCreatePost(body: object) {
	expect(fetchMock).toHaveBeenCalledWith(
		"/api/runs/create",
		expect.objectContaining({
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		}),
	)
}

describe("createRun", () => {
	const choices: CapabilitySelection[] = [{}, { email: true }, { email: "on_demand" }]
	it.each(choices)("preserves explicit capabilities %j in the launch request", async (capabilities) => {
		fetchMock.mockResolvedValueOnce(okJson({ run_id: "selected" }))
		await createRun({ project: "alpha", capabilities })
		expectCreatePost({ project: "alpha", capabilities })
	})

	it("fetches the capability catalog without caching and supports cancellation", async () => {
		const controller = new AbortController()
		fetchMock.mockResolvedValueOnce(okJson([]))
		expect(await listCapabilities({ signal: controller.signal })).toEqual([])
		expect(fetchMock).toHaveBeenCalledWith("/api/capabilities", expect.objectContaining({ cache: "no-store", signal: controller.signal }))
	})

	it.each([null, {}, { email: "on_demand", removed: true }])("reads saved choices unchanged: %j", async (saved) => {
		const controller = new AbortController()
		fetchMock.mockResolvedValueOnce(okJson(saved))
		expect(await getProjectCapabilitySelection("alpha beta", { signal: controller.signal })).toEqual(saved)
		expect(fetchMock).toHaveBeenCalledWith("/api/capabilities/alpha%20beta", expect.objectContaining({
			method: "GET", cache: "no-store", signal: controller.signal,
		}))
	})

	it("posts the selection directly to the project's capabilities route", async () => {
		const choices: CapabilitySelection = { email: "on_demand" }
		fetchMock.mockResolvedValueOnce(okJson(choices))
		expect(await saveProjectCapabilitySelection("alpha beta", choices)).toEqual(choices)
		expect(fetchMock).toHaveBeenCalledWith("/api/capabilities/alpha%20beta", expect.objectContaining({
			method: "POST", cache: "no-store", body: JSON.stringify(choices),
			headers: { Accept: "application/json", "Content-Type": "application/json" },
		}))
	})

	beforeEach(() => {
		fetchMock.mockReset()
		vi.stubGlobal("fetch", fetchMock)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	it("POSTs to /api/runs/create and returns run id response", async () => {
		fetchMock.mockResolvedValueOnce(
			okJson<CreateResponse>({ run_id: "run-uuid-1" }),
		)

		const result = await createRun({ project: "alpha" })

		expect(result).toEqual({ run_id: "run-uuid-1" })
		expect(fetchMock).toHaveBeenCalledTimes(1)
		expectCreatePost({ project: "alpha" })
	})

	it("sends project for requested run creation", async () => {
		fetchMock.mockResolvedValueOnce(
			okJson<CreateResponse>({ run_id: "r2" }),
		)

		await createRun({ project: "beta" })
		expectCreatePost({ project: "beta" })
	})

	it("forwards signal to fetch", async () => {
		const ac = new AbortController()
		fetchMock.mockResolvedValueOnce(
			okJson<CreateResponse>({ run_id: "r3" }),
		)

		await createRun({ project: "alpha" }, { signal: ac.signal })

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/runs/create",
			expect.objectContaining({ signal: ac.signal }),
		)
	})

	it("throws AgentApiError with detail from error JSON", async () => {
		fetchMock.mockResolvedValueOnce(
			errJson({ detail: "unknown run_id" }, 404),
		)

		await expect(createRun({ project: "alpha" })).rejects.toMatchObject({
			name: "AgentApiError",
			status: 404,
			message: "unknown run_id",
		})
	})

	it("throws AgentApiError with generic message when no detail", async () => {
		fetchMock.mockResolvedValueOnce(errJson({}, 500))

		await expect(createRun({ project: "alpha" })).rejects.toMatchObject({
			name: "AgentApiError",
			status: 500,
			message: "Request failed (500)",
		})
	})
})

describe("projects api", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", fetchMock)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	it("listProjects GETs /api/projects and returns project summaries", async () => {
		fetchMock.mockResolvedValueOnce(
			okJson([
				{
					slug: "alpha",
					status: "dormant",
					run_id: null,
					created_at: null,
				},
				{
					slug: "beta",
					status: "syncing",
					run_id: null,
					created_at: null,
				},
			]),
		)

		const result = await listProjects()

		expect(result).toEqual([
			{
				slug: "alpha",
				status: "dormant",
				run_id: null,
				created_at: null,
			},
			{
				slug: "beta",
				status: "syncing",
				run_id: null,
				created_at: null,
			},
		])
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/projects",
			expect.objectContaining({
				method: "GET",
				cache: "no-store",
				headers: { Accept: "application/json" },
			}),
		)
	})

	it("createProject POSTs /api/projects and returns slug", async () => {
		fetchMock.mockResolvedValueOnce(okJson({ slug: "my-project" }))

		const result = await createProject({ name: "My Project" })

		expect(result).toEqual({ slug: "my-project" })
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/projects",
			expect.objectContaining({
				method: "POST",
				headers: {
					Accept: "application/json",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ name: "My Project" }),
			}),
		)
	})

	it("deleteProject DELETEs /api/projects/{slug}", async () => {
		fetchMock.mockResolvedValueOnce(okJson({ ok: true }))

		const result = await deleteProject("my-project")

		expect(result).toEqual({ ok: true })
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/projects/my-project",
			expect.objectContaining({
				method: "DELETE",
				headers: { Accept: "application/json" },
			}),
		)
	})

	it("cancelProject POSTs /api/projects/{slug}/cancel and returns ok", async () => {
		fetchMock.mockResolvedValueOnce(okJson({ ok: true }))

		const result = await cancelProject("syncing-project")

		expect(result).toEqual({ ok: true })
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/projects/syncing-project/cancel",
			expect.objectContaining({
				method: "POST",
				headers: { Accept: "application/json" },
			}),
		)
	})

	it("deleteProject surfaces the 409 detail as a AgentApiError", async () => {
		fetchMock.mockResolvedValueOnce(
			errJson(
				{ detail: "project has an active run; cancel it first" },
				409,
			),
		)

		await expect(deleteProject("busy")).rejects.toMatchObject({
			name: "AgentApiError",
			status: 409,
			message: "project has an active run; cancel it first",
		})
	})
})

describe("dependencies api", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", fetchMock)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	const dependencies = [
		{
			dependency_id: "executable:bash",
			kind: "executable" as const,
			redacted_metadata: { executable: "bash" },
			status: "available" as const,
			checked_at: "2026-07-23T08:00:00Z",
			latency_ms: 1.25,
			reason_code: null,
			message: null,
		},
	]

	it("GETs cached dependency records without caching the response", async () => {
		fetchMock.mockResolvedValueOnce(okJson(dependencies))

		await expect(listDependencies()).resolves.toEqual(dependencies)
		expect(fetchMock).toHaveBeenCalledWith("/api/admin/dependencies", {
			method: "GET",
			cache: "no-store",
			headers: { Accept: "application/json" },
			signal: undefined,
		})
	})

	it("POSTs an active check and returns the updated records", async () => {
		const controller = new AbortController()
		fetchMock.mockResolvedValueOnce(okJson(dependencies))

		await expect(
			checkDependencies({ signal: controller.signal }),
		).resolves.toEqual(dependencies)
		expect(fetchMock).toHaveBeenCalledWith("/api/admin/dependencies", {
			method: "POST",
			cache: "no-store",
			headers: { Accept: "application/json" },
			signal: controller.signal,
		})
	})

	it("forwards dependency endpoint errors", async () => {
		fetchMock.mockResolvedValueOnce(
			errJson({ detail: "dependency check unavailable" }, 503),
		)

		await expect(checkDependencies()).rejects.toMatchObject({
			name: "AgentApiError",
			status: 503,
			message: "dependency check unavailable",
		})
	})
})

describe("model selection api", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", fetchMock)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	it("loads and updates the process-wide base model", async () => {
		const selection = {
			models: [],
			selected_model_id: "model:cerebras:gpt-oss-120b",
		}
		fetchMock
			.mockResolvedValueOnce(okJson(selection))
			.mockResolvedValueOnce(okJson(selection))

		await expect(getModelSelection()).resolves.toEqual(selection)
		expect(fetchMock).toHaveBeenLastCalledWith(
			"/api/models",
			expect.objectContaining({ method: "GET", cache: "no-store" }),
		)

		fetchMock.mockResolvedValueOnce(okJson(selection))
		await expect(
			getModelSelection({ runId: "run/one" }),
		).resolves.toEqual(selection)
		expect(fetchMock).toHaveBeenLastCalledWith(
			"/api/models?run_id=run%2Fone",
			expect.objectContaining({ method: "GET", cache: "no-store" }),
		)

		await expect(
			selectModel({
				model_id: selection.selected_model_id,
				run_id: "run-one",
			}),
		).resolves.toEqual(selection)
		expect(fetchMock).toHaveBeenLastCalledWith(
			"/api/models",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({
					model_id: selection.selected_model_id,
					run_id: "run-one",
				}),
			}),
		)
	})
})

describe("cancelProject", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", fetchMock)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	it("POSTs /api/projects/{slug}/cancel and returns ok", async () => {
		fetchMock.mockResolvedValueOnce(okJson({ ok: true }))

		const result = await cancelProject("run-1")

		expect(result).toEqual({ ok: true })
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/projects/run-1/cancel",
			expect.objectContaining({
				method: "POST",
				headers: { Accept: "application/json" },
			}),
		)
	})

	it("throws AgentApiError for an unknown project", async () => {
		fetchMock.mockResolvedValueOnce(
			errJson({ detail: "unknown project" }, 404),
		)

		await expect(cancelProject("ghost")).rejects.toMatchObject({
			name: "AgentApiError",
			status: 404,
			message: "unknown project",
		})
	})
})

describe("interruptRun", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", fetchMock)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	it("POSTs /api/runs/{runId}/interrupt and returns ok", async () => {
		fetchMock.mockResolvedValueOnce(okJson({ ok: true }))

		const result = await interruptRun("run-1")

		expect(result).toEqual({ ok: true })
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/runs/run-1/interrupt",
			expect.objectContaining({
				method: "POST",
				headers: { Accept: "application/json" },
			}),
		)
	})
})

describe("transcribeAudio", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", fetchMock)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	it("POSTs the audio as multipart and returns the transcript", async () => {
		fetchMock.mockResolvedValueOnce(okJson({ text: "hello there" }))

		const result = await transcribeAudio(
			new Blob(["x"], { type: "audio/webm" }),
		)

		expect(result).toEqual({ text: "hello there" })
		const lastCall = fetchMock.mock.calls.at(-1)
		const [url, init] = lastCall ?? []
		expect(url).toBe("/api/transcribe")
		expect(init?.method).toBe("POST")
		// FormData carries its own multipart Content-Type; we must not set it.
		expect(init?.body).toBeInstanceOf(FormData)
		expect((init?.body as FormData).get("file")).toBeInstanceOf(Blob)
	})
})
