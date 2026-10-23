// Transcribe one recorded clip (`POST /transcribe`). useDictation owns recording
// and the request's lifetime; this module has no local state.
import { ApiError, type DesktopApiClient } from "../api/client"

/** A provider round trip takes longer than the usual request deadline. */
export const TRANSCRIPTION_TIMEOUT_MS = 60_000

export async function transcribeAudio(client: DesktopApiClient, audio: Blob, signal: AbortSignal): Promise<string> {
	const form = new FormData()
	// The filename carries the extension the backend uses to label the upload.
	form.append("file", audio, "recording.webm")
	const value = await client.request("/transcribe", { method: "POST", form, signal })
	if (!value || typeof value !== "object" || !("text" in value) || typeof value.text !== "string") {
		throw new ApiError("malformed", "The backend returned an invalid transcription.")
	}
	return value.text
}
