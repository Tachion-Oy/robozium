"use client"

import type { FormEventHandler } from "react"
import {
	AgentMessagePanel,
	type AgentMessage,
} from "./AgentMessagePanel"
import {
	HudControls,
	type HudControlModel,
} from "./HudControls"
import type { LayoutMode } from "../HudCornerControls"
import type { HudMessageNavigationModel } from "./HudMessageNavigation"
import { ReplyEditor } from "./ReplyEditor"

export type ReplyComposerModel = {
	value: string
	isReplyAvailable: boolean
	isSubmitting: boolean
	onChange: (value: string) => void
	onSubmit: () => void | Promise<void>
}

type ReplyFormProps = {
	message: AgentMessage
	composer: ReplyComposerModel
	navigation: HudMessageNavigationModel
	controls: HudControlModel
	layoutMode: LayoutMode
}

export function ReplyForm({
	message,
	composer,
	navigation,
	controls,
	layoutMode,
}: ReplyFormProps) {
	const canSubmit = Boolean(
		composer.value.trim() &&
			composer.isReplyAvailable &&
			!composer.isSubmitting &&
			!controls.cancel?.isPending &&
			!controls.interrupt?.isPending,
	)

	const handleSubmit: FormEventHandler<HTMLFormElement> = (event) => {
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
					canSubmit={canSubmit}
					onChange={composer.onChange}
				/>
			</div>
			<HudControls
				{...controls}
				agentMessage={message}
				navigation={navigation}
				replyDraft={composer.value}
				onClearReply={() => composer.onChange("")}
				submission={{
					canSubmit,
					isSubmitting: composer.isSubmitting,
				}}
			/>
			{controls.dictation.error ? (
				<p
					className="agent-hud__dictation-error"
					role="status">
					{controls.dictation.error}
				</p>
			) : null}
		</form>
	)
}
