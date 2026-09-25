import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useDictation } from "../../hooks/useDictation"
import { AgentApiError, transcribeAudio } from "../../lib/robozium/client"

vi.mock("../../lib/robozium/client", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../lib/robozium/client")>()),
	transcribeAudio: vi.fn(),
}))

vi.mock("../../app/components/feedback/ErrorToast", () => ({
	showErrorToast: vi.fn(),
}))
import { showErrorToast } from "../../app/components/feedback/ErrorToast"

const showErrorToastMock = vi.mocked(showErrorToast)
const transcribeAudioMock = vi.mocked(transcribeAudio)

let animationFrameCallback: FrameRequestCallback | null = null
let animationFrameId = 0
const cancelAnimationFrameMock = vi.fn()
const analyserDisconnect = vi.fn()
const sourceDisconnect = vi.fn()
const audioContextClose = vi.fn().mockResolvedValue(undefined)

class FakeAudioContext {
	static amplitude = 0

	resume = vi.fn().mockResolvedValue(undefined)
	close = audioContextClose

	createAnalyser() {
		return {
			fftSize: 0,
			disconnect: analyserDisconnect,
			getByteTimeDomainData: (samples: Uint8Array) => {
				for (let index = 0; index < samples.length; index += 1) {
					const direction = index % 2 === 0 ? -1 : 1
					samples[index] = 128 + direction * FakeAudioContext.amplitude
				}
			},
		}
	}

	createMediaStreamSource() {
		return {
			connect: vi.fn(),
			disconnect: sourceDisconnect,
		}
	}
}

function runAnimationFrame() {
	const callback = animationFrameCallback
	animationFrameCallback = null
	callback?.(performance.now())
}

/** Minimal MediaRecorder stand-in: stop() drives a one-chunk recording. */
class FakeMediaRecorder {
	static last: FakeMediaRecorder | null = null
	ondataavailable: ((event: { data: Blob }) => void) | null = null
	onstop: (() => void) | null = null
	mimeType = "audio/webm"
	state: RecordingState = "inactive"

	constructor(public stream: MediaStream) {
		FakeMediaRecorder.last = this
	}

	start() {
		this.state = "recording"
	}

	stop() {
		this.state = "inactive"
		this.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) })
		this.onstop?.()
	}
}

const trackStop = vi.fn()

beforeEach(() => {
	transcribeAudioMock.mockReset()
	showErrorToastMock.mockReset()
	trackStop.mockReset()
	animationFrameCallback = null
	animationFrameId = 0
	cancelAnimationFrameMock.mockReset()
	analyserDisconnect.mockReset()
	sourceDisconnect.mockReset()
	audioContextClose.mockClear()
	FakeAudioContext.amplitude = 0
	FakeMediaRecorder.last = null
	vi.stubGlobal("MediaRecorder", FakeMediaRecorder)
	vi.stubGlobal("AudioContext", undefined)
	vi.stubGlobal("navigator", {
		mediaDevices: {
			getUserMedia: vi.fn().mockResolvedValue({
				getTracks: () => [{ stop: trackStop }],
			}),
		},
	})
})

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("useDictation", () => {
	it("records, transcribes, and delivers the transcript", async () => {
		transcribeAudioMock.mockResolvedValue({ text: "dictated text" })
		const onTranscript = vi.fn()
		const { result } = renderHook(() => useDictation({ onTranscript }))

		await act(async () => {
			result.current.toggle()
		})
		await waitFor(() => expect(result.current.isRecording).toBe(true))

		await act(async () => {
			result.current.toggle()
		})

		await waitFor(() => expect(onTranscript).toHaveBeenCalledWith("dictated text"))
		expect(result.current.isRecording).toBe(false)
		expect(result.current.isTranscribing).toBe(false)
		expect(trackStop).toHaveBeenCalled()
	})

	it("reports live audio levels and tears the analyser down when stopped", async () => {
		transcribeAudioMock.mockResolvedValue({ text: "dictated text" })
		vi.stubGlobal("AudioContext", FakeAudioContext)
		vi.stubGlobal(
			"requestAnimationFrame",
			vi.fn((callback: FrameRequestCallback) => {
				animationFrameCallback = callback
				animationFrameId += 1
				return animationFrameId
			}),
		)
		vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrameMock)

		const { result } = renderHook(() =>
			useDictation({ onTranscript: vi.fn() }),
		)

		await act(async () => {
			result.current.toggle()
		})
		await waitFor(() => expect(result.current.isRecording).toBe(true))

		act(runAnimationFrame)
		expect(result.current.audioLevel).toBe(0)

		FakeAudioContext.amplitude = 64
		act(runAnimationFrame)
		expect(result.current.audioLevel).toBeGreaterThan(0)

		await act(async () => {
			result.current.toggle()
		})

		expect(result.current.audioLevel).toBe(0)
		expect(cancelAnimationFrameMock).toHaveBeenCalled()
		expect(sourceDisconnect).toHaveBeenCalled()
		expect(analyserDisconnect).toHaveBeenCalled()
		expect(audioContextClose).toHaveBeenCalled()
	})

	it("surfaces an error when the transcription request fails", async () => {
		transcribeAudioMock.mockRejectedValue(new Error("boom"))
		const onTranscript = vi.fn()
		const { result } = renderHook(() => useDictation({ onTranscript }))

		await act(async () => {
			result.current.toggle()
		})
		await act(async () => {
			result.current.toggle()
		})

		await waitFor(() => expect(showErrorToastMock).toHaveBeenCalledWith({
			title: "Transcription failed",
			message: "Could not transcribe audio. Try again.",
		}))
		expect(onTranscript).not.toHaveBeenCalled()
	})

	it.each([
		[503, "Voice transcription is not configured for this server."],
		[423, "Unlock API keys before using providers"],
	])("preserves the API explanation for %s on each failed recording", async (status, message) => {
		transcribeAudioMock.mockRejectedValue(new AgentApiError(status, message))
		const { result } = renderHook(() => useDictation({ onTranscript: vi.fn() }))
		for (let attempt = 0; attempt < 2; attempt += 1) {
			await act(async () => result.current.toggle())
			await act(async () => result.current.toggle())
		}
		expect(showErrorToastMock).toHaveBeenCalledTimes(2)
		expect(showErrorToastMock).toHaveBeenLastCalledWith({
			title: "Transcription failed",
			message,
		})
		expect(result.current.isTranscribing).toBe(false)
	})

	it("reports an error when no microphone is available", async () => {
		vi.stubGlobal("navigator", { mediaDevices: undefined })
		const onTranscript = vi.fn()
		const { result } = renderHook(() => useDictation({ onTranscript }))

		await act(async () => {
			result.current.toggle()
		})

		await waitFor(() =>
			expect(showErrorToastMock).toHaveBeenCalledWith({
				title: "Recording failed",
				message: "Microphone is not available in this browser.",
			}),
		)
		expect(result.current.isRecording).toBe(false)
	})

	it("reports an error when MediaRecorder is unavailable", async () => {
		vi.stubGlobal("MediaRecorder", undefined)
		const onTranscript = vi.fn()
		const { result } = renderHook(() => useDictation({ onTranscript }))

		await act(async () => {
			result.current.toggle()
		})

		await waitFor(() =>
			expect(showErrorToastMock).toHaveBeenCalledWith({
				title: "Recording failed",
				message: "Audio recording is not available in this browser.",
			}),
		)
		expect(result.current.isRecording).toBe(false)
	})

	it("aborts in-flight transcription when unmounted", async () => {
		let signal: AbortSignal | undefined
		transcribeAudioMock.mockImplementation((_audio, init) => {
			signal = init?.signal
			return new Promise((_resolve, reject) => {
				signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
			})
		})
		const onTranscript = vi.fn()
		const { result, unmount } = renderHook(() => useDictation({ onTranscript }))

		await act(async () => {
			result.current.toggle()
		})
		await waitFor(() => expect(result.current.isRecording).toBe(true))
		await act(async () => {
			result.current.toggle()
		})
		await waitFor(() => expect(signal).toBeDefined())

		await act(async () => unmount())

		expect(signal?.aborted).toBe(true)
		expect(showErrorToastMock).not.toHaveBeenCalled()
	})

	it("does not reset active recording when the parent rerenders", async () => {
		const firstTranscript = vi.fn()
		const secondTranscript = vi.fn()
		const { result, rerender } = renderHook(
			({ onTranscript }) => useDictation({ onTranscript }),
			{ initialProps: { onTranscript: firstTranscript } },
		)

		await act(async () => {
			result.current.toggle()
		})
		await waitFor(() => expect(result.current.isRecording).toBe(true))

		rerender({ onTranscript: secondTranscript })

		expect(result.current.isRecording).toBe(true)
		expect(trackStop).not.toHaveBeenCalled()
		expect(firstTranscript).not.toHaveBeenCalled()
		expect(secondTranscript).not.toHaveBeenCalled()
	})
})
