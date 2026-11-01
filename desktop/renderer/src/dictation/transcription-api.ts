// Transcribe one recorded clip (`POST /transcribe`). useDictation owns recording
// and the request's lifetime; this module has no local state.
import { z } from "zod"
import { parsePayload, type DesktopApiClient } from "../api/client"

/** A provider round trip takes longer than the usual request deadline. */
export const TRANSCRIPTION_TIMEOUT_MS = 60_000

export async function transcribeAudio(client: DesktopApiClient, audio: Blob, signal: AbortSignal): Promise<string> {
	const form = new FormData()
	// The filename carries the extension the backend uses to label the upload.
	form.append("file", audio, "recording.webm")
	const value = await client.request("/transcribe", { method: "POST", form, signal })
	return parsePayload(z.object({ text: z.string() }), value, "The backend returned an invalid transcription.").text
}
