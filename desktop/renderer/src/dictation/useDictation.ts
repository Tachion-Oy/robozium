"use client"

import { useEffect, useRef, useState } from "react"
import { AgentApiError, transcribeAudio } from "@/lib/robozium/client"
import { showErrorToast } from "@/app/components/feedback/ErrorToast"

export type UseDictationResult = {
	/** Mic is open and capturing. */
	isRecording: boolean
	/** Normalized live microphone level while recording. */
	audioLevel: number
	/** Audio captured; waiting on the transcript. */
	isTranscribing: boolean
	/** Start on first call, stop-and-transcribe on the next. */
	toggle: () => void
}

type UseDictationOptions = {
	/** Receives the transcript once recording stops and the round trip returns. */
	onTranscript: (text: string) => void
}

type RecordingSession = {
	recorder: MediaRecorder
	stream: MediaStream
}

type RecordingSessionHandlers = {
	onChunk: (chunk: Blob) => void
	onStop: (session: RecordingSession) => void
}

type AudioLevelMonitor = {
	audioContext: AudioContext
	analyser: AnalyserNode
	source: MediaStreamAudioSourceNode
	frameId: number
}

const AUDIO_LEVEL_SEGMENTS = 6
const AUDIO_NOISE_FLOOR = 0.02
const AUDIO_LEVEL_CEILING = 0.2

async function ignoreAudioContextError(operation: () => Promise<void> | undefined) {
	try {
		await operation()
	} catch {
		// The optional level monitor must not block recording or cleanup.
	}
}

function startAudioLevelMonitor(
	stream: MediaStream,
	onLevel: (level: number) => void,
): AudioLevelMonitor | null {
	if (
		typeof AudioContext === "undefined" ||
		typeof requestAnimationFrame === "undefined"
	) {
		return null
	}

	let audioContext: AudioContext | null = null
	let analyser: AnalyserNode
	let source: MediaStreamAudioSourceNode
	try {
		audioContext = new AudioContext()
		analyser = audioContext.createAnalyser()
		source = audioContext.createMediaStreamSource(stream)
		source.connect(analyser)
	} catch {
		void ignoreAudioContextError(() => audioContext?.close())
		return null
	}
	if (!audioContext) return null

	analyser.fftSize = 256
	const samples = new Uint8Array(analyser.fftSize)
	let displayedLevel = 0
	let displayedSegments = 0

	const monitor: AudioLevelMonitor = {
		audioContext,
		analyser,
		source,
		frameId: 0,
	}

	const sample = () => {
		analyser.getByteTimeDomainData(samples)
		let sumSquares = 0
		for (const sample of samples) {
			const normalizedSample = (sample - 128) / 128
			sumSquares += normalizedSample * normalizedSample
		}

		const rms = Math.sqrt(sumSquares / samples.length)
		const normalizedLevel = Math.min(
			1,
			Math.max(
				0,
				(rms - AUDIO_NOISE_FLOOR) /
					(AUDIO_LEVEL_CEILING - AUDIO_NOISE_FLOOR),
			),
		)
		const smoothing = normalizedLevel > displayedLevel ? 0.55 : 0.2
		displayedLevel += (normalizedLevel - displayedLevel) * smoothing
		if (displayedLevel < 0.015) displayedLevel = 0

		const nextSegments =
			displayedLevel === 0
				? 0
				: Math.max(1, Math.ceil(displayedLevel * AUDIO_LEVEL_SEGMENTS))
		if (nextSegments !== displayedSegments) {
			displayedSegments = nextSegments
			onLevel(nextSegments / AUDIO_LEVEL_SEGMENTS)
		}
		monitor.frameId = requestAnimationFrame(sample)
	}

	void ignoreAudioContextError(() => audioContext.resume())
	monitor.frameId = requestAnimationFrame(sample)
	return monitor
}

function stopAudioLevelMonitor(monitor: AudioLevelMonitor | null) {
	if (!monitor) return

	cancelAnimationFrame(monitor.frameId)
	monitor.source.disconnect()
	monitor.analyser.disconnect()
	void ignoreAudioContextError(() => monitor.audioContext.close())
}

function stopTracks(stream: MediaStream | null) {
	stream?.getTracks().forEach((track) => track.stop())
}

function stopRecording(session: RecordingSession | null) {
	if (!session || session.recorder.state === "inactive") return

	session.recorder.stop()
}

function discardRecording(session: RecordingSession | null) {
	if (!session) return

	session.recorder.ondataavailable = null
	session.recorder.onstop = null
	stopRecording(session)
	stopTracks(session.stream)
}

function createAudioBlob(chunks: Blob[], recorder: MediaRecorder) {
	return new Blob(chunks, {
		type: recorder.mimeType || "audio/webm",
	})
}

async function startRecordingSession({
	onChunk,
	onStop,
}: RecordingSessionHandlers): Promise<
	{ session: RecordingSession } | { error: string }
> {
	if (
		typeof navigator === "undefined" ||
		!navigator.mediaDevices?.getUserMedia
	) {
		return { error: "Microphone is not available in this browser." }
	}
	if (typeof MediaRecorder === "undefined") {
		return { error: "Audio recording is not available in this browser." }
	}

	let stream: MediaStream
	try {
		stream = await navigator.mediaDevices.getUserMedia({ audio: true })
	} catch {
		return { error: "Microphone permission was denied." }
	}

	let recorder: MediaRecorder
	try {
		recorder = new MediaRecorder(stream)
	} catch {
		stopTracks(stream)
		return { error: "Audio recording is not available in this browser." }
	}

	const session = { recorder, stream }
	recorder.ondataavailable = (event) => {
		if (event.data.size > 0) onChunk(event.data)
	}
	recorder.onstop = () => onStop(session)
	recorder.start()

	return { session }
}

/**
 * Browser-native push-to-toggle dictation. Records the mic with MediaRecorder,
 * then POSTs the clip to the hub for transcription. No streaming: one clip in,
 * one transcript out. Requires a secure context (HTTPS, or localhost in dev).
 */
export function useDictation({
	onTranscript,
}: UseDictationOptions): UseDictationResult {
	const [isRecording, setIsRecording] = useState(false)
	const [audioLevel, setAudioLevel] = useState(0)
	const [isTranscribing, setIsTranscribing] = useState(false)

	const sessionRef = useRef<RecordingSession | null>(null)
	const audioLevelMonitorRef = useRef<AudioLevelMonitor | null>(null)
	const chunksRef = useRef<Blob[]>([])
	const abortControllerRef = useRef<AbortController | null>(null)
	const cancelledRef = useRef(false)

	async function transcribe(audio: Blob) {
		const controller = new AbortController()
		abortControllerRef.current = controller
		setIsTranscribing(true)
		try {
			const { text } = await transcribeAudio(audio, {
				signal: controller.signal,
			})
			if (text.trim()) onTranscript(text.trim())
		} catch (error) {
			if (!controller.signal.aborted && !cancelledRef.current) {
				showErrorToast({
					title: "Transcription failed",
					message: error instanceof AgentApiError
						? error.message
						: "Could not transcribe audio. Try again.",
				})
			}
		} finally {
			if (abortControllerRef.current === controller) {
				abortControllerRef.current = null
			}
			if (!cancelledRef.current) {
				setIsTranscribing(false)
			}
		}
	}

	function finishRecording(session: RecordingSession) {
		stopAudioLevelMonitor(audioLevelMonitorRef.current)
		audioLevelMonitorRef.current = null
		setAudioLevel(0)
		stopTracks(session.stream)
		sessionRef.current = null
		setIsRecording(false)
		if (cancelledRef.current) return

		const audio = createAudioBlob(chunksRef.current, session.recorder)
		chunksRef.current = []
		if (audio.size === 0) {
			showErrorToast({ title: "Recording failed", message: "No audio was recorded." })
			return
		}

		void transcribe(audio)
	}

	async function start() {
		cancelledRef.current = false

		chunksRef.current = []
		const result = await startRecordingSession({
			onChunk: (chunk) => chunksRef.current.push(chunk),
			onStop: finishRecording,
		})

		if ("error" in result) {
			if (!cancelledRef.current) {
				showErrorToast({ title: "Recording failed", message: result.error })
			}
			return
		}
		if (cancelledRef.current) {
			discardRecording(result.session)
			return
		}

		sessionRef.current = result.session
		audioLevelMonitorRef.current = startAudioLevelMonitor(
			result.session.stream,
			setAudioLevel,
		)
		setIsRecording(true)
	}

	useEffect(() => {
		return () => {
			cancelledRef.current = true
			abortControllerRef.current?.abort()
			abortControllerRef.current = null
			stopAudioLevelMonitor(audioLevelMonitorRef.current)
			audioLevelMonitorRef.current = null

			discardRecording(sessionRef.current)
			sessionRef.current = null
			chunksRef.current = []
		}
	}, [])

	function toggle() {
		if (isTranscribing) return
		if (isRecording) {
			stopRecording(sessionRef.current)
		} else {
			void start()
		}
	}

	return { isRecording, audioLevel, isTranscribing, toggle }
}
