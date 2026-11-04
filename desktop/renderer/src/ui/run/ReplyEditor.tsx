// autoFocus focuses the reply when Current Run opens; restored previews
// load from the backend with crossorigin; the composer is disabled only with its
// editor, not whenever files cannot be added; no "Updating images…" notice
// flashes beneath the reply, and upload failures are a toast with Retry attachments; the
// placeholder says "Enter", since a reply is typed or dictated.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEventHandler } from "react"
import type { DropzoneState } from "react-dropzone"
import type { ReplyAttachment, ReplyAttachmentsModel } from "../../attachments/useReplyAttachments"
import { Toast } from "../feedback/Toast"

type ReplyEditorProps = {
	value: string
	attachments?: ReplyAttachmentsModel
	dropzone?: DropzoneState
	canSubmit: boolean
	disabled?: boolean
	autoFocus?: boolean
	onChange: (value: string) => void
}

export function ReplyEditor({
	value,
	attachments,
	dropzone,
	canSubmit,
	disabled = false,
	autoFocus = false,
	onChange,
}: ReplyEditorProps) {
	const textareaRef = useRef<HTMLTextAreaElement>(null)
	const lastLocalValueRef = useRef(value)
	const attachmentListRef = useRef<HTMLUListElement>(null)
	const previousAttachmentsRef = useRef<readonly ReplyAttachment[]>([])
	const items = attachments?.items

	useLayoutEffect(() => {
		const previous = previousAttachmentsRef.current
		previousAttachmentsRef.current = items ?? []
		if (!items?.some((image) => !previous.some((old) => old.url === image.url))) return
		if (textareaRef.current) textareaRef.current.scrollTop = 0
		if (attachmentListRef.current) attachmentListRef.current.scrollTop = attachmentListRef.current.scrollHeight
	}, [items])

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
			{attachments?.error && <Toast tone="error" title="Attachments" message={attachments.error}
				actions={attachments.canRetry ? [{ label: "Retry attachments", onClick: attachments.onRetry }] : []} />}
			{dropzone ? <input {...dropzone.getInputProps({ "aria-label": "Choose files" })} /> : null}
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
					placeholder="Enter your reply..."
				/>
			</div>
			{items?.length ? (
				<ul className="agent-hud__reply-images" aria-label="Attachments" ref={attachmentListRef} tabIndex={0}>
					{items.map((attachment) => (
						<ReplyAttachmentPreview key={attachment.url} attachment={attachment} onRemove={() => {
							attachments?.onRemove(attachment.url)
							textareaRef.current?.focus({ preventScroll: true })
						}} />
					))}
				</ul>
			) : null}
		</div>
	)
}

function ReplyAttachmentPreview({ attachment, onRemove }: { attachment: ReplyAttachment; onRemove: () => void }) {
	const [status, setStatus] = useState<"loading" | "loaded" | "error">(attachment.kind === "pdf" ? "loaded" : "loading")
	const uploading = attachment.status === "queued" || attachment.status === "uploading"
	return (
		<li className="agent-hud__reply-image" data-kind={attachment.kind} aria-busy={status === "loading" || uploading}>
			{attachment.kind === "pdf" ? (
				<span className="agent-hud__reply-document" role="img" aria-label={attachment.name} title={attachment.name}>
					<PdfIcon />
					<span className="agent-hud__reply-document-name">{attachment.name}</span>
				</span>
			) : (
				/* The desktop backend admits hub file reads only with the renderer's Origin. */
				<img src={attachment.url} crossOrigin="anonymous" alt={attachment.name} onLoad={() => setStatus("loaded")} onError={() => setStatus("error")} />
			)}
			{status !== "loaded" ? (
				<span className="agent-hud__reply-image-status" role="status">
					{status === "loading" ? "Loading…" : "Preview unavailable"}
				</span>
			) : null}
			{attachment.status !== "ready" ? <span className="agent-hud__reply-image-status" role="status">
				{attachment.status === "failed" ? "Update failed" : attachment.status === "removing" ? "Removing…" : "Uploading…"}
			</span> : null}
			<button type="button" className="agent-hud__remove-image" onClick={onRemove} aria-label={`Remove ${attachment.name}`} title={`Remove ${attachment.name}`}>×</button>
		</li>
	)
}

/** A generic document page with a folded corner and a PDF label, in theme colours. */
function PdfIcon() {
	return (
		<svg className="agent-hud__reply-document-icon" viewBox="0 0 24 30" aria-hidden="true">
			<path className="agent-hud__reply-document-page" d="M2.5 1.5h13l6 6v21h-19z" />
			<path className="agent-hud__reply-document-fold" d="M15.5 1.5v6h6" />
			<rect className="agent-hud__reply-document-band" x="0.5" y="15" width="17" height="8" rx="1" />
			<text className="agent-hud__reply-document-label" x="9" y="21.2" textAnchor="middle">PDF</text>
		</svg>
	)
}
