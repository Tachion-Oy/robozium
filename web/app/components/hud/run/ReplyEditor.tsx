"use client"

import { useEffect, useRef, type KeyboardEventHandler } from "react"

type ReplyEditorProps = {
	value: string
	canSubmit: boolean
	onChange: (value: string) => void
}

export function ReplyEditor({
	value,
	canSubmit,
	onChange,
}: ReplyEditorProps) {
	const textareaRef = useRef<HTMLTextAreaElement>(null)
	const lastLocalValueRef = useRef(value)

	useEffect(() => {
		const wasChangedExternally = value !== lastLocalValueRef.current
		lastLocalValueRef.current = value
		if (!wasChangedExternally) return

		const textarea = textareaRef.current
		if (textarea) textarea.scrollTop = textarea.scrollHeight
	}, [value])

	const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
		if (
			event.key !== "Enter" ||
			event.shiftKey ||
			event.nativeEvent.isComposing
		) return

		event.preventDefault()
		if (canSubmit) event.currentTarget.form?.requestSubmit()
	}

	return (
		<div className="agent-hud__replyBox agent-hud__replyBox--user">
			<textarea
				className="agent-hud__textarea"
				ref={textareaRef}
				value={value}
				onChange={(event) => {
					lastLocalValueRef.current = event.target.value
					onChange(event.target.value)
				}}
				onKeyDown={handleKeyDown}
				placeholder="Type your reply..."
			/>
		</div>
	)
}
