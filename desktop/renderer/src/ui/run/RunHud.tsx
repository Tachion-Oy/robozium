// Copied from robozium-electron/desktop/web/app/components/hud/run/RunHud.tsx at 076b2c9.
// Adapted: the displayed run and its reply, interrupt and cancel writes come from
// the desktop owners as props; their owners report failures. Dictation comes
// from App, so a recording outlives view switches. Images follow
// web/app/components/hud/run/RunHud.tsx at 2a0c183.
import type { Dispatch, SetStateAction } from "react"
import type { ReplyImagesModel } from "../../attachments/useReplyImages"
import type { UseDictationResult } from "../../dictation/useDictation"
import type { HudDisplay } from "../../hud/hud-view"
import type { ReplyImages, ReplyResult } from "../../session/useRunMutations"
import type { LayoutMode } from "../hud/HudCornerControls"
import type { AgentMessage } from "./AgentMessagePanel"
import type { HudPendingAction } from "./HudControls"
import { ReplyForm } from "./ReplyForm"
import { AgentActivityState, type HudMessageNavigationDirection } from "./run-view"

type RunHudProps = {
	draft: string
	onDraftChange: Dispatch<SetStateAction<string>>
	images: ReplyImagesModel
	dictation: UseDictationResult
	layoutMode: LayoutMode
	display: HudDisplay
	awaitingInput: boolean
	focusOnOpen: boolean
	onSelect: (index: number) => void
	reply: {
		available: boolean
		submitting: boolean
		submit: (content: string, images: ReplyImages) => Promise<ReplyResult>
	}
	cancel: HudPendingAction
	interrupt: HudPendingAction
	/** The backend address of a hub file, for inline agent images. */
	hubFileUrl?: (path: string) => string
}

export function RunHud({
	draft,
	onDraftChange,
	images,
	dictation,
	layoutMode,
	display,
	awaitingInput,
	focusOnOpen,
	onSelect,
	reply,
	cancel,
	interrupt,
	hubFileUrl,
}: RunHudProps) {
	const { index, currentIndex, count } = display
	const message: AgentMessage = {
		id: display.id,
		content: display.text,
		contentType: display.contentType,
		mode: display.streaming ? "streaming" : index === currentIndex ? "current" : "history",
		indicator: display.working,
	}
	const handleSubmit = async () => {
		const submittedDraft = draft
		// The owner reports failures; an acknowledged reply clears only an unchanged draft.
		if (await reply.submit(draft, images) === "acknowledged") {
			onDraftChange((current) =>
				current === submittedDraft ? "" : current,
			)
		}
	}

	const targets: Record<HudMessageNavigationDirection, number> = {
		first: 0,
		previous: index - 1,
		next: index + 1,
		latest: currentIndex,
	}

	return (
		<ReplyForm
			message={message}
			hubFileUrl={hubFileUrl}
			layoutMode={layoutMode}
			composer={{
				value: draft,
				images,
				isReplyAvailable: reply.available,
				isSubmitting: reply.submitting,
				focusOnOpen,
				onChange: onDraftChange,
				onSubmit: handleSubmit,
			}}
			navigation={{
				agentActivityState: awaitingInput
					? AgentActivityState.AwaitingInput
					: AgentActivityState.Working,
				enabled: {
					first: index > 0,
					previous: index > 0,
					next: index < count - 1,
					latest: index !== currentIndex,
				},
				onNavigate: (direction) => onSelect(targets[direction]),
			}}
			controls={{
				dictation: {
					isRecording: dictation.isRecording,
					audioLevel: dictation.audioLevel,
					isTranscribing: dictation.isTranscribing,
					available: dictation.available,
					onToggle: dictation.toggle,
				},
				cancel,
				interrupt,
			}}
		/>
	)
}
