import assert from "node:assert/strict"
import { test } from "node:test"
import { BackendApi } from "../../src/backend-api.ts"

/** An API answering each route with a fixed body and status, recording what was asked. */
function api(routes: Record<string, { body: unknown; status?: number }>) {
	const requests: string[] = []
	const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
		const route = String(url).replace("http://127.0.0.1:18000", "")
		requests.push(`${init?.method} ${route} ${new Headers(init?.headers).get("Origin")}`)
		const answer = routes[route] ?? { body: { detail: "Not Found" }, status: 404 }
		return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 })
	}
	return { client: new BackendApi("http://127.0.0.1:18000", fetcher), requests }
}
const signal = () => new AbortController().signal

test("active projects leave out dormant ones, and a cancel posts to the project's own route", async () => {
	const { client, requests } = api({
		"/projects": { body: [
			{ slug: "busy", status: "running", run_id: "r", created_at: 1 },
			{ slug: "idle", status: "dormant", run_id: null, created_at: null },
			{ slug: "a b", status: "syncing", run_id: null, created_at: null },
		] },
		"/projects/a%20b/cancel": { body: { ok: true } },
	})
	assert.deepEqual(await client.activeProjects(signal()), ["busy", "a b"])
	await client.cancelProject("a b", signal())
	assert.deepEqual(requests, ["GET /projects robozium://app", "POST /projects/a%20b/cancel robozium://app"])
})

test("a malformed project list or a refused request is an error, never an empty list", async () => {
	for (const body of [{ projects: [] }, [{ status: "running" }], [{ slug: "", status: "running" }], [{ slug: "x" }]]) {
		await assert.rejects(api({ "/projects": { body } }).client.activeProjects(signal()), /invalid project list/)
	}
	await assert.rejects(api({ "/projects": { body: [], status: 503 } }).client.activeProjects(signal()), /GET \/projects returned 503/)
	await assert.rejects(api({}).client.cancelProject("gone", signal()), /POST \/projects\/gone\/cancel returned 404/)
})

test("readiness is true only for a ready answer; a failure is not ready unless the caller aborted", async () => {
	assert.equal(await api({ "/ready": { body: { status: "ready" } } }).client.ready(signal()), true)
	assert.equal(await api({ "/ready": { body: { status: "starting" } } }).client.ready(signal()), false)
	assert.equal(await api({ "/ready": { body: {}, status: 503 } }).client.ready(signal()), false)
	const aborted = AbortSignal.abort()
	await assert.rejects(new BackendApi("http://127.0.0.1:18000", async () => { throw new Error("refused") }).ready(aborted), { name: "AbortError" })
})
