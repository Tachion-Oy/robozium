// Typed operations for creating a run, reading its snapshot and following its event stream.
// Payload validation lives in run-payloads; session code owns request lifetimes and reconciliation.
import { z } from "zod"
import { type DesktopApiClient } from "../api/client"
import { parsePayload } from "../api/payload"
import type { CapabilitySelection } from "../capabilities/capabilities-api"
import type { RunFrame, RunView } from "./run-contracts"
import { parseCreatedRunId, parseRunEvent, parseRunSnapshot } from "./run-payloads"

const ReplyAccepted = z.object({ ok: z.literal(true) })
const Acknowledgement = z.object({ ok: z.boolean() })

/** A null selection lets the backend use its default capabilities and reuse any active run. */
export async function createRun(
	client: DesktopApiClient, project: string, capabilities: CapabilitySelection | null, signal: AbortSignal,
): Promise<string> {
	const response = await client.request("/run/create", { method: "POST", json: { project, capabilities }, signal })
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

/** Writes are acknowledged explicitly; callers never replay them automatically. */
export async function submitReply(
	client: DesktopApiClient, runId: string, promptId: string, content: string, signal: AbortSignal,
): Promise<void> {
	const value = await client.request(`/run/${encodeURIComponent(runId)}/reply`, {
		method: "POST", json: { prompt_id: promptId, content }, signal,
	})
	parsePayload(ReplyAccepted, value, "The backend did not acknowledge the reply.")
}

/** Resolves false when the backend refuses, for example because the run already stopped. */
export async function interruptRun(client: DesktopApiClient, runId: string, signal: AbortSignal): Promise<boolean> {
	const value = await client.request(`/run/${encodeURIComponent(runId)}/interrupt`, { method: "POST", signal })
	return parsePayload(Acknowledgement, value, "The backend returned an invalid interruption acknowledgement.").ok
}
