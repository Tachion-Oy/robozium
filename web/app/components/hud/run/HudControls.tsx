import { HudButton } from "../HudButton"
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
	locked?: boolean
	replyDraft: string
	hasImages?: boolean
	onAddImages?: () => void
	imagesDisabled?: boolean
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
	locked = false,
	replyDraft,
	hasImages = false,
	onAddImages,
	imagesDisabled,
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
					<HudButton
						appearance="control"
						variant="warning"
						className="agent-hud__cancel"
						onClick={cancel.onTrigger}
						disabled={locked || cancel.isPending}>
						{cancel.isPending ? "Cancelling..." : "Cancel"}
					</HudButton>
				) : null}
				{interrupt ? (
					<HudButton
						appearance="control"
						variant="danger"
						className="agent-hud__interrupt"
						onClick={interrupt.onTrigger}
						disabled={locked || interrupt.isPending || cancel?.isPending}>
						{interrupt.isPending ? "Interrupting..." : "Interrupt"}
					</HudButton>
				) : null}
			</div>
			<HudMessageNavigation {...navigation} />
			<div className="agent-hud__actions-submit">
				<HudCopyControls
					agentMessage={agentMessage}
					replyDraft={replyDraft}
					hasImages={hasImages}
					disabled={locked}
					onClearReply={onClearReply}
				/>
				<div className="agent-hud__composer-buttons">
					{onAddImages ? (
						<HudButton
							appearance="control"
							variant="success"
							className="agent-hud__image"
							onClick={onAddImages}
							disabled={imagesDisabled}
							title="Add images (PNG, JPEG, WebP, GIF; up to four, 10 MiB each)">
							image
						</HudButton>
					) : null}
					<HudButton
						appearance="control"
						variant="success"
						className="agent-hud__dictate"
						onClick={dictation.onToggle}
						disabled={locked || dictation.isTranscribing}
						data-dictation-state={dictationState}
						aria-label={dictationAccessibleLabel}
						title={dictation.isTranscribing ? dictationAccessibleLabel : undefined}
						aria-pressed={dictation.isRecording}>
						<span>{dictationLabel}</span>
						{dictation.isRecording ? (
							<AudioLevelMeter level={dictation.audioLevel ?? 0} />
						) : null}
					</HudButton>
					<HudButton
						appearance="control"
						type="submit"
						variant="success"
						primary
						className="agent-hud__send"
						disabled={
							submission.isSubmitting ||
							!submission.canSubmit ||
							cancel?.isPending ||
							interrupt?.isPending
						}>
						Send
					</HudButton>
				</div>
			</div>
		</div>
	)
}
