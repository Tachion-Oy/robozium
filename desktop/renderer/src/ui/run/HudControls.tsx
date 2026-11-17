// `available: false` shows an action disabled until its owner arrives;
// a pending action is busy under its own label, which a span can truncate.
import { useFooterActionLayout } from "./useFooterActionLayout"
import { AudioLevelMeter } from "./AudioLevelMeter"
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
	available: boolean
	onTrigger: () => void
}

export type HudControlModel = {
	dictation: HudDictationControls
	cancel: HudPendingAction
	interrupt: HudPendingAction
}

type HudControlsProps = HudControlModel & {
	navigation: HudMessageNavigationModel
	/** Disable every control except message navigation. */
	locked: boolean
	/** Missing while files cannot be added: react-dropzone returns no `open` when disabled, whatever its types say. The button is then left out. */
	onAddAttachments?: () => void
	attachmentsDisabled: boolean
	/** The reply can be sent now: nothing is pending and there is something to send. */
	canSubmit: boolean
}

export function HudControls({
	dictation,
	navigation,
	locked,
	onAddAttachments,
	attachmentsDisabled,
	canSubmit,
	cancel,
	interrupt,
}: HudControlsProps) {
	const actionsRef = useFooterActionLayout()
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
				<button
					type="button"
					className="agent-hud__cancel"
					onClick={cancel.onTrigger}
					disabled={locked || cancel.isPending || !cancel.available}
					aria-busy={cancel.isPending || undefined}>
					<span>Cancel</span>
				</button>
				<button
					type="button"
					className="agent-hud__interrupt"
					onClick={interrupt.onTrigger}
					disabled={locked || interrupt.isPending || !interrupt.available || cancel.isPending}
					aria-busy={interrupt.isPending || undefined}>
					<span>Interrupt</span>
				</button>
			</div>
			<div className="agent-hud__navigation-row">
				<HudMessageNavigation {...navigation} />
			</div>
			<div className="agent-hud__actions-submit">
				{onAddAttachments ? (
					<button
						type="button"
						className="agent-hud__image"
						onClick={onAddAttachments}
						disabled={attachmentsDisabled}
						aria-label="Add files"
						title="Add files (images are sent to the model; up to four, 10 MiB each)">
						<svg className="agent-hud__image-icon" viewBox="0 0 16 16" aria-hidden="true">
							<path d="M8 1.2v13.6M1.2 8h13.6" />
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
					disabled={!canSubmit}>
					<span>Send</span>
				</button>
			</div>
		</div>
	)
}
