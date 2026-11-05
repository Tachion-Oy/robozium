// One composer attachment tile: images preview from the backend with
// crossorigin; other files show a generic document labelled with their extension.
import { useState } from "react"
import type { ReplyAttachment } from "../../attachments/useReplyAttachments"

export function ReplyAttachmentPreview({ attachment, onRemove }: { attachment: ReplyAttachment; onRemove: () => void }) {
	const [loaded, setLoaded] = useState<"loading" | "loaded" | "error">("loading")
	// The backend may decide a pasted image is a plain file; that tile needs no loading.
	const status = attachment.kind === "image" ? loaded : "loaded"
	const uploading = attachment.status === "queued" || attachment.status === "uploading"
	return (
		<li className="agent-hud__reply-image" data-kind={attachment.kind} aria-busy={status === "loading" || uploading}>
			{attachment.kind === "file" ? (
				<span className="agent-hud__reply-document" role="img" aria-label={attachment.name} title={attachment.name}>
					<DocumentIcon label={extensionLabel(attachment.name)} />
					<span className="agent-hud__reply-document-name">{attachment.name}</span>
				</span>
			) : (
				/* The desktop backend admits hub file reads only with the renderer's Origin. */
				<img src={attachment.url} crossOrigin="anonymous" alt={attachment.name} onLoad={() => setLoaded("loaded")} onError={() => setLoaded("error")} />
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

/** The extension in capitals, or FILE when there is none or it does not fit the band. */
function extensionLabel(name: string): string {
	const extension = /\.([a-z0-9]{1,4})$/i.exec(name)?.[1]
	return extension ? extension.toUpperCase() : "FILE"
}

/** A generic document page with a folded corner and a type label, in theme colours. */
function DocumentIcon({ label }: { label: string }) {
	return (
		<svg className="agent-hud__reply-document-icon" viewBox="0 0 24 30" aria-hidden="true">
			<path className="agent-hud__reply-document-page" d="M2.5 1.5h13l6 6v21h-19z" />
			<path className="agent-hud__reply-document-fold" d="M15.5 1.5v6h6" />
			<rect className="agent-hud__reply-document-band" x="0.5" y="15" width="17" height="8" rx="1" />
			<text className="agent-hud__reply-document-label" x="9" y="21.2" textAnchor="middle" textLength={label.length > 3 ? 15 : undefined} lengthAdjust="spacingAndGlyphs">{label}</text>
		</svg>
	)
}
