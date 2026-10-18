"use client"

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEventHandler } from "react"
import type { DropzoneState } from "react-dropzone"
import type { ReplyImage, ReplyImagesModel } from "@/hooks/useReplyImages"

type ReplyEditorProps = {
	value: string
	images?: ReplyImagesModel
	dropzone?: DropzoneState
	canSubmit: boolean
	onChange: (value: string) => void
}

export function ReplyEditor({
	value,
	images,
	dropzone,
	canSubmit,
	onChange,
}: ReplyEditorProps) {
	const textareaRef = useRef<HTMLTextAreaElement>(null)
	const lastLocalValueRef = useRef(value)
	const imageListRef = useRef<HTMLUListElement>(null)
	const previousImagesRef = useRef<readonly ReplyImage[]>([])
	const attachments = images?.images

	useLayoutEffect(() => {
		const previous = previousImagesRef.current
		previousImagesRef.current = attachments ?? []
		if (!attachments?.some((image) => !previous.includes(image))) return
		if (textareaRef.current) textareaRef.current.scrollTop = 0
		if (imageListRef.current) imageListRef.current.scrollTop = imageListRef.current.scrollHeight
	}, [attachments])

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
		<div
			{...dropzone?.getRootProps({ role: "group", "aria-label": "Reply composer", tabIndex: 0 })}
			className="agent-hud__replyBox agent-hud__replyBox--user"
			data-drag-active={dropzone?.isDragActive || undefined}>
			{dropzone ? <input {...dropzone.getInputProps({ "aria-label": "Choose images" })} /> : null}
			<div className="agent-hud__reply-text">
				<textarea
					className="agent-hud__textarea"
					aria-label="Reply text"
					ref={textareaRef}
					value={value}
					onChange={(event) => {
						lastLocalValueRef.current = event.target.value
						onChange(event.target.value)
					}}
					onKeyDown={handleKeyDown}
					placeholder="Type your reply..."
				/>
				{images?.images.length ? (
					<p id="reply-image-notice" className="agent-hud__reply-notice" role="status">
						Images can be previewed but not sent yet.
					</p>
				) : null}
				{images?.error ? <p className="agent-hud__reply-notice" role="alert">{images.error}</p> : null}
			</div>
			{images?.images.length ? (
				<ul className="agent-hud__reply-images" aria-label="Image previews" ref={imageListRef} tabIndex={0}>
					{images.images.map((image) => (
						<ReplyImagePreview key={image.url} image={image} onRemove={() => {
							images.onRemove(image.url)
							textareaRef.current?.focus({ preventScroll: true })
						}} />
					))}
				</ul>
			) : null}
		</div>
	)
}

function ReplyImagePreview({ image, onRemove }: { image: ReplyImage; onRemove: () => void }) {
	const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading")
	return (
		<li className="agent-hud__reply-image" aria-busy={status === "loading"}>
			{/* Object URLs are local previews; Next's image optimizer cannot serve them. */}
			{/* eslint-disable-next-line @next/next/no-img-element */}
			<img src={image.url} alt={image.name} onLoad={() => setStatus("loaded")} onError={() => setStatus("error")} />
			{status !== "loaded" ? (
				<span className="agent-hud__reply-image-status" role="status">
					{status === "loading" ? "Loading…" : "Preview unavailable"}
				</span>
			) : null}
			<button type="button" className="agent-hud__remove-image" onClick={onRemove} aria-label={`Remove ${image.name}`} title={`Remove ${image.name}`}>×</button>
		</li>
	)
}
