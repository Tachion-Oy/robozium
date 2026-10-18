// Typed operations for creating a run, reading its snapshot and following its event stream.
// Payload validation lives in run-payloads; session code owns request lifetimes and reconciliation.
import { ApiError, type DesktopApiClient } from "../api/client"
import type { RunFrame, RunView } from "./run-contracts"
import { parseCreatedRunId, parseRunEvent, parseRunSnapshot } from "./run-payloads"

export async function createRun(client: DesktopApiClient, project: string, signal: AbortSignal): Promise<string> {
	const response = await client.request("/run/create", { method: "POST", json: { project }, signal })
	return parseCreatedRunId(response)
}

export async function getRunSnapshot(client: DesktopApiClient, runId: string, signal: AbortSignal): Promise<RunView> {
	const response = await client.request(`/run/${encodeURIComponent(runId)}`, { signal })
	return parseRunSnapshot(response)
}

export async function* streamRunEvents(client: DesktopApiClient, runId: string, signal: AbortSignal, onOpen?: () => void): AsyncGenerator<RunFrame> {
	for await (const value of client.streamEvents(`/run/${encodeURIComponent(runId)}/stream`, signal, onOpen)) {
		const event = parseRunEvent(value)
		if (event) yield event
	}
}

/** Writes are acknowledged explicitly; callers must never replay them automatically. */
export async function submitReply(client: DesktopApiClient, runId: string, promptId: string, content: string, signal: AbortSignal): Promise<void> {
	const value = await client.request(`/run/${encodeURIComponent(runId)}/reply`, {
		method: "POST", json: { prompt_id: promptId, content }, signal,
	})
	if (!value || typeof value !== "object" || !("ok" in value) || value.ok !== true) {
		throw new ApiError("malformed", "The backend did not acknowledge the reply.")
	}
}

export async function interruptRun(client: DesktopApiClient, runId: string, signal: AbortSignal): Promise<boolean> {
	const value = await client.request(`/run/${encodeURIComponent(runId)}/interrupt`, { method: "POST", signal })
	if (!value || typeof value !== "object" || !("ok" in value) || typeof value.ok !== "boolean") {
		throw new ApiError("malformed", "The backend returned an invalid interruption acknowledgement.")
	}
	return value.ok
}
