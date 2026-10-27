// Copied from web/app/components/hud/run/ReplyEditor.tsx at 2a0c183.
// Adapted: autoFocus focuses the reply when Current Run opens; restored previews
// load from the backend with crossorigin; the composer is disabled only with its
// editor, not whenever images cannot be added; no "Updating images…" notice
// flashes beneath the reply, and image failures are a toast with Retry images.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEventHandler } from "react"
import type { DropzoneState } from "react-dropzone"
import type { ReplyImage, ReplyImagesModel } from "../../attachments/useReplyImages"
import { usePersistentToast } from "../../feedback/notices"

type ReplyEditorProps = {
	value: string
	images?: ReplyImagesModel
	dropzone?: DropzoneState
	canSubmit: boolean
	disabled?: boolean
	autoFocus?: boolean
	onChange: (value: string) => void
}

export function ReplyEditor({
	value,
	images,
	dropzone,
	canSubmit,
	disabled = false,
	autoFocus = false,
	onChange,
}: ReplyEditorProps) {
	const textareaRef = useRef<HTMLTextAreaElement>(null)
	const lastLocalValueRef = useRef(value)
	const imageListRef = useRef<HTMLUListElement>(null)
	const previousImagesRef = useRef<readonly ReplyImage[]>([])
	const attachments = images?.images
	usePersistentToast("reply-images", images?.error ? {
		tone: "error",
		title: "Images",
		message: images.error,
		actions: images.canRetry ? [{ label: "Retry images", onClick: images.onRetry }] : undefined,
	} : null)

	useLayoutEffect(() => {
		const previous = previousImagesRef.current
		previousImagesRef.current = attachments ?? []
		if (!attachments?.some((image) => !previous.some((old) => old.url === image.url))) return
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
			data-drag-active={dropzone?.isDragActive || undefined}
			aria-disabled={disabled || undefined}>
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
					disabled={disabled}
					autoFocus={autoFocus}
					placeholder="Type your reply..."
				/>
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
		<li className="agent-hud__reply-image" aria-busy={status === "loading" || image.status === "queued" || image.status === "uploading"}>
			{/* The desktop backend admits hub file reads only with the renderer's Origin. */}
			<img src={image.url} crossOrigin="anonymous" alt={image.name} onLoad={() => setStatus("loaded")} onError={() => setStatus("error")} />
			{status !== "loaded" ? (
				<span className="agent-hud__reply-image-status" role="status">
					{status === "loading" ? "Loading…" : "Preview unavailable"}
				</span>
			) : null}
			{image.status !== "ready" ? <span className="agent-hud__reply-image-status" role="status">
				{image.status === "failed" ? "Image update failed" : image.status === "removing" ? "Removing…" : "Uploading…"}
			</span> : null}
			<button type="button" className="agent-hud__remove-image" onClick={onRemove} aria-label={`Remove ${image.name}`} title={`Remove ${image.name}`}>×</button>
		</li>
	)
}
