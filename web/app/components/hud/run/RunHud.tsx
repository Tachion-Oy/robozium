"use client"

import { useState, type Dispatch, type SetStateAction } from "react"
import { streamingDisplayText } from "@/lib/robozium/streaming-text"
import {
	agentActivityStateForPhase,
	getActiveStreamingMessage,
	RunHudPhase,
} from "@/lib/robozium/session/reducer"
import { useRunSession, useRunSessionSelector } from "@/hooks/useRunSession"
import { useDictation } from "@/hooks/useDictation"
import { getHudMessages } from "@/lib/robozium/hud-messages"
import { showErrorToast } from "@/app/components/feedback/ErrorToast"
import type { AgentMessage } from "./AgentMessagePanel"
import type { LayoutMode } from "../HudCornerControls"
import { ReplyForm } from "./ReplyForm"

type RunHudProps = {
	draft: string
	onDraftChange: Dispatch<SetStateAction<string>>
	layoutMode: LayoutMode
}

export function RunHud({
	draft,
	onDraftChange,
	layoutMode,
}: RunHudProps) {
	const session = useRunSession()
	const phase = useRunSessionSelector(
		(state) => state.hud.phase,
		RunHudPhase.Passive,
	)
	const prompt = useRunSessionSelector((state) => state.hud.prompt, null)
	const promptId = useRunSessionSelector((state) => state.hud.promptId, null)
	const messages = useRunSessionSelector((state) => state.hud.messages, [])
	const selectedMessageId = useRunSessionSelector(
		(state) => state.hud.selectedMessageId,
		null,
	)
	const hudMessages = getHudMessages(messages, selectedMessageId)
	const isCancelling = useRunSessionSelector(
		(state) => state.hud.isCancelling,
		false,
	)
	const isInterrupting = useRunSessionSelector(
		(state) => state.hud.isInterrupting,
		false,
	)
	const activeStream = useRunSessionSelector(getActiveStreamingMessage, null)
	const [isSubmitting, setIsSubmitting] = useState(false)

	const {
		audioLevel,
		error: dictationError,
		isRecording,
		isTranscribing,
		toggle: toggleDictation,
	} = useDictation({
		onTranscript: (text) =>
			onDraftChange((current) =>
				current.trim() ? `${current.trimEnd()} ${text}` : text,
			),
	})

	const handleCancel = async () => {
		if (await session?.cancelRun()) return
		showErrorToast({
			title: "Cancellation failed",
			message: "Could not cancel this project.",
			detail: "The project is still active. Try again.",
		})
	}

	const handleSubmit = async () => {
		const submittedDraft = draft
		const content = draft.trim()
		if (!content || !promptId || isSubmitting || !session) return

		setIsSubmitting(true)
		try {
			const submitted = await session.submitReply(content)
			if (submitted) {
				onDraftChange((current) =>
					current === submittedDraft ? "" : current,
				)
			}
		} finally {
			setIsSubmitting(false)
		}
	}

	if (phase === RunHudPhase.Done) return null

	// Run phases only choose what the agent panel shows. The composer stays
	// available for drafting and dictation until the run reaches a terminal state.
	const liveMessage: AgentMessage =
		phase === RunHudPhase.Streaming
			? {
					id: `live:${activeStream?.messageId ?? phase}`,
					content: activeStream
						? streamingDisplayText(activeStream.text)
						: "",
					mode: "streaming",
				}
			: phase === RunHudPhase.Prompting
				? {
						id: `live:${promptId ?? phase}`,
						content: prompt ?? "",
						mode: "current",
					}
				: {
							id: `live:${phase}`,
							content: "",
							mode: "current",
						}
	const message = hudMessages.message ?? liveMessage

	return (
		<ReplyForm
			message={message}
			layoutMode={layoutMode}
			composer={{
				value: draft,
				isReplyAvailable: promptId !== null,
				isSubmitting,
				onChange: onDraftChange,
				onSubmit: handleSubmit,
			}}
			navigation={{
				agentActivityState: agentActivityStateForPhase(phase),
				enabled: hudMessages.navigation.enabled,
				onNavigate: (direction) => session?.navigateHudMessage(direction),
			}}
			controls={{
				dictation: {
					isRecording,
					audioLevel,
					isTranscribing,
					error: dictationError,
					onToggle: toggleDictation,
				},
				cancel: {
					isPending: isCancelling,
					onTrigger: () => void handleCancel(),
				},
				interrupt: {
					isPending: isInterrupting,
					onTrigger: () => void session?.interruptRun(),
				},
			}}
		/>
	)
}
