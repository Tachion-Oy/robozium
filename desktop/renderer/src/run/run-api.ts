// Typed operations for creating a run, reading its snapshot and following its event stream.
// Payload validation lives in run-payloads; session code owns request lifetimes and reconciliation.
import type { DesktopApiClient } from "../api/client"
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

export async function* streamRunEvents(client: DesktopApiClient, runId: string, signal: AbortSignal): AsyncGenerator<RunFrame> {
	for await (const value of client.streamEvents(`/run/${encodeURIComponent(runId)}/stream`, signal)) {
		const event = parseRunEvent(value)
		if (event) yield event
	}
}
