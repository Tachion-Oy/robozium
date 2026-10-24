// Copied from web/app/components/hud/run/ReplyForm.tsx at 2a0c183.
// Adapted: the composer can focus the reply on open.
import type { SubmitEventHandler } from "react"
import { useDropzone } from "react-dropzone"
import {
	REPLY_IMAGE_ACCEPT,
	REPLY_IMAGE_LIMIT,
	REPLY_IMAGE_MAX_BYTES,
	type ReplyImagesModel,
} from "../../attachments/useReplyImages"
import {
	AgentMessagePanel,
	type AgentMessage,
} from "./AgentMessagePanel"
import {
	HudControls,
	type HudControlModel,
} from "./HudControls"
import type { LayoutMode } from "../hud/HudCornerControls"
import type { HudMessageNavigationModel } from "./HudMessageNavigation"
import { ReplyEditor } from "./ReplyEditor"

export type ReplyComposerModel = {
	value: string
	images: ReplyImagesModel
	isReplyAvailable: boolean
	isSubmitting: boolean
	focusOnOpen?: boolean
	onChange: (value: string) => void
	onSubmit: () => void | Promise<void>
}

type ReplyFormProps = {
	message: AgentMessage
	composer: ReplyComposerModel
	navigation: HudMessageNavigationModel
	controls: HudControlModel
	layoutMode: LayoutMode
	/** Disable every control except message navigation. */
	locked?: boolean
}

export function ReplyForm({
	message,
	composer,
	navigation,
	controls,
	layoutMode,
	locked = false,
}: ReplyFormProps) {
	const dropzone = useDropzone({
		accept: REPLY_IMAGE_ACCEPT,
		maxSize: REPLY_IMAGE_MAX_BYTES,
		maxFiles: REPLY_IMAGE_LIMIT,
		noClick: true,
		noKeyboard: true,
		onDrop: composer.images.onDrop,
		disabled: locked || !composer.images.canAdd || controls.cancel?.isPending,
	})
	const canSubmit = Boolean(
		!locked &&
		(composer.value.trim() || composer.images.images.length) &&
			composer.images.isReady &&
			composer.isReplyAvailable &&
			!composer.isSubmitting &&
			!controls.cancel?.isPending &&
			!controls.interrupt?.isPending,
	)

	const handleSubmit: SubmitEventHandler<HTMLFormElement> = (event) => {
		event.preventDefault()
		if (canSubmit) void composer.onSubmit()
	}

	return (
		<form
			className="agent-hud__replySection"
			data-streaming={message.mode === "streaming" || undefined}
			data-history={message.mode === "history" || undefined}
			data-agent-state={navigation.agentActivityState}
			onSubmit={handleSubmit}>
			<div
				className="agent-hud__panels"
				data-layout={layoutMode}>
				<AgentMessagePanel message={message} />
				<ReplyEditor
					value={composer.value}
					images={composer.images}
					dropzone={dropzone}
					canSubmit={canSubmit}
					disabled={locked}
					autoFocus={composer.focusOnOpen}
					onChange={composer.onChange}
				/>
			</div>
			<HudControls
				{...controls}
				agentMessage={message}
				navigation={navigation}
				locked={locked}
				replyDraft={composer.value}
				hasImages={composer.images.images.length > 0}
				onAddImages={dropzone.open}
				imagesDisabled={locked || !composer.images.canAdd || controls.cancel?.isPending}
				onClearReply={() => {
					composer.onChange("")
					composer.images.onClear()
				}}
				submission={{
					canSubmit,
					isSubmitting: composer.isSubmitting,
				}}
			/>
		</form>
	)
}
