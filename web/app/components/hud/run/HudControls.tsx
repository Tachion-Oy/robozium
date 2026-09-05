import { AudioLevelMeter } from "./AudioLevelMeter"
import type { AgentMessage } from "./AgentMessagePanel"
import { HudCopyControls } from "./HudCopyControls"
import {
	HudMessageNavigation,
	type HudMessageNavigationModel,
} from "./HudMessageNavigation"

export type HudDictationControls = {
	isRecording: boolean
	audioLevel?: number
	isTranscribing: boolean
	error: string | null
	onToggle: () => void
}

export type HudPendingAction = {
	isPending: boolean
	onTrigger: () => void
}

export type HudControlModel = {
	dictation: HudDictationControls
	cancel?: HudPendingAction
	interrupt?: HudPendingAction
}

type HudControlsProps = HudControlModel & {
	agentMessage: AgentMessage
	navigation: HudMessageNavigationModel
	replyDraft: string
	onClearReply: () => void
	submission: {
		canSubmit: boolean
		isSubmitting: boolean
	}
}

export function HudControls({
	agentMessage,
	dictation,
	navigation,
	replyDraft,
	onClearReply,
	submission,
	cancel,
	interrupt,
}: HudControlsProps) {
	const dictationLabel = dictation.isTranscribing
		? "Text…"
		: dictation.isRecording
			? "Stop"
			: "Record"
	const dictationAccessibleLabel = dictation.isTranscribing
		? "Transcribing voice input"
		: dictationLabel
	const dictationState = dictation.isTranscribing
		? "transcribing"
		: dictation.isRecording
			? "recording"
			: "idle"

	return (
		<div className="agent-hud__actions">
			<div className="agent-hud__run-actions">
				{cancel ? (
					<button
						type="button"
						className="agent-hud__cancel"
						onClick={cancel.onTrigger}
						disabled={cancel.isPending}>
						{cancel.isPending ? "Cancelling..." : "Cancel"}
					</button>
				) : null}
				{interrupt ? (
					<button
						type="button"
						className="agent-hud__interrupt"
						onClick={interrupt.onTrigger}
						disabled={interrupt.isPending || cancel?.isPending}>
						{interrupt.isPending ? "Interrupting..." : "Interrupt"}
					</button>
				) : null}
			</div>
			<HudMessageNavigation {...navigation} />
			<div className="agent-hud__actions-submit">
				<HudCopyControls
					agentMessage={agentMessage}
					replyDraft={replyDraft}
					onClearReply={onClearReply}
				/>
				<button
					type="button"
					className="agent-hud__dictate"
					onClick={dictation.onToggle}
					disabled={dictation.isTranscribing}
					data-dictation-state={dictationState}
					aria-label={dictationAccessibleLabel}
					title={dictation.isTranscribing ? dictationAccessibleLabel : undefined}
					aria-pressed={dictation.isRecording}>
					<span>{dictationLabel}</span>
					{dictation.isRecording ? (
						<AudioLevelMeter level={dictation.audioLevel ?? 0} />
					) : null}
				</button>
				<button
					type="submit"
					className="agent-hud__send"
					disabled={
						submission.isSubmitting ||
						!submission.canSubmit ||
						cancel?.isPending ||
						interrupt?.isPending
					}>
					Send
				</button>
			</div>
		</div>
	)
}
