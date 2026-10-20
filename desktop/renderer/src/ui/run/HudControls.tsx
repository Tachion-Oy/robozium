// Copied from robozium-electron/desktop/web/app/components/hud/run/HudControls.tsx at 076b2c9.
// Adapted: `available: false` shows an action disabled until its owner arrives;
// a pending action is busy under its own label, which a span can truncate.
import { useDesktopActionLayout } from "./useDesktopActionLayout"
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
	available?: boolean
	onToggle: () => void
}

export type HudPendingAction = {
	isPending: boolean
	available?: boolean
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
	const actionsRef = useDesktopActionLayout()
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
		<div
			ref={actionsRef}
			className="agent-hud__actions">
			<div className="agent-hud__run-actions">
				{cancel ? (
					<button
						type="button"
						className="agent-hud__cancel"
						onClick={cancel.onTrigger}
						disabled={cancel.isPending || cancel.available === false}
						aria-busy={cancel.isPending || undefined}>
						<span>Cancel</span>
					</button>
				) : null}
				{interrupt ? (
					<button
						type="button"
						className="agent-hud__interrupt"
						onClick={interrupt.onTrigger}
						disabled={interrupt.isPending || interrupt.available === false || cancel?.isPending}
						aria-busy={interrupt.isPending || undefined}>
						<span>Interrupt</span>
					</button>
				) : null}
			</div>
			<div className="agent-hud__navigation-row">
				<HudMessageNavigation {...navigation} />
			</div>
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
					disabled={dictation.isTranscribing || dictation.available === false}
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
					<span>Send</span>
				</button>
			</div>
		</div>
	)
}
