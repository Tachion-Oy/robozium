// Copied from robozium-electron/desktop/web/app/components/hud/run/HudControls.tsx at 076b2c9.
// Adapted: `available: false` shows an action disabled until its owner arrives;
// a pending action is busy under its own label, which a span can truncate.
// The image picker follows web/app/components/hud/run/HudControls.tsx at 2a0c183,
// and the setup lock web at af87bea (#121).
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
	/** Disable every control except message navigation. */
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
						disabled={locked || cancel.isPending || cancel.available === false}
						aria-busy={cancel.isPending || undefined}>
						<span>Cancel</span>
					</button>
				) : null}
				{interrupt ? (
					<button
						type="button"
						className="agent-hud__interrupt"
						onClick={interrupt.onTrigger}
						disabled={locked || interrupt.isPending || interrupt.available === false || cancel?.isPending}
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
					hasImages={hasImages}
					disabled={locked}
					onClearReply={onClearReply}
				/>
				{onAddImages ? (
					<button
						type="button"
						className="agent-hud__image"
						onClick={onAddImages}
						disabled={imagesDisabled}
						aria-label="Add images"
						title="Add images (PNG, JPEG, WebP, GIF; up to four, 10 MiB each)">
						<svg className="agent-hud__image-icon" viewBox="0 0 16 16" aria-hidden="true">
							<path d="M8 1.5v13M1.5 8h13" />
						</svg>
					</button>
				) : null}
				<button
					type="button"
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
