"use client"

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react"

type ImageSelection = {
	src: string
	description: string
	trigger: HTMLElement
	width: number
	height: number
}

const ImageViewerContext = createContext<(image: ImageSelection) => void>(() => {})
// Linked images must not place a button (or a fallback link) inside an anchor.
export const HudImageLinkContext = createContext(false)

export function HudImageViewer({ children }: { children: ReactNode }) {
	const [selection, setSelection] = useState<ImageSelection | null>(null)
	return (
		<ImageViewerContext value={setSelection}>
			{children}
			{selection ? <ImageDialog key={selection.src} image={selection} onClose={() => setSelection(null)} /> : null}
		</ImageViewerContext>
	)
}

function ImageDialog({ image, onClose }: { image: ImageSelection; onClose: () => void }) {
	const dialogRef = useRef<HTMLDialogElement>(null)
	const closeRef = useRef<HTMLButtonElement>(null)
	const originalRef = useRef<HTMLAnchorElement>(null)
	const [failed, setFailed] = useState(false)

	useEffect(() => {
		const dialog = dialogRef.current!
		dialog.showModal()
		closeRef.current?.focus({ preventScroll: true })
		return () => {
			dialog.close()
			if (image.trigger.isConnected) image.trigger.focus({ preventScroll: true })
		}
	}, [image])

	return (
		<dialog
			ref={dialogRef}
			className="agent-hud__image-dialog"
			aria-label={image.description}
			onCancel={onClose}
			onKeyDownCapture={(event) => {
				// Native dialogs can tab into browser chrome; keep the two controls cycling.
				if (event.key === "Tab") {
					if (event.shiftKey && document.activeElement === originalRef.current) {
						event.preventDefault()
						closeRef.current?.focus()
					} else if (!event.shiftKey && document.activeElement === closeRef.current) {
						event.preventDefault()
						originalRef.current?.focus()
					}
				}
				// Next delegates React events on document, where the HUD also listens.
				// Stop both propagation and other native listeners, keeping native cancel.
				if (event.key === "Escape") {
					event.stopPropagation()
					event.nativeEvent.stopImmediatePropagation()
				}
			}}
			onClick={(event) => {
				if (event.target !== event.currentTarget) return
				const bounds = event.currentTarget.getBoundingClientRect()
				if (event.clientX < bounds.left || event.clientX > bounds.right ||
					event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
			}}>
			<div className="agent-hud__image-toolbar">
				<span>{image.description}</span>
				<a ref={originalRef} className="agent-hud__markdown-link" href={image.src} target="_blank" rel="noreferrer">Open original</a>
				<button ref={closeRef} type="button" onClick={onClose}>Close</button>
			</div>
			<div className="agent-hud__image-stage" style={{ width: image.width, aspectRatio: `${image.width} / ${image.height}` }}>
				{failed ? <p role="status">Image unavailable</p> : (
					/* Hub files and remote sources are served directly, without an optimizer. */
					/* eslint-disable-next-line @next/next/no-img-element */
					<img src={image.src} alt={image.description} referrerPolicy="no-referrer" decoding="async" onError={() => setFailed(true)} />
				)}
			</div>
		</dialog>
	)
}

export function HudImage({ src, alt }: { src?: string; alt?: string }) {
	const open = useContext(ImageViewerContext)
	const linked = useContext(HudImageLinkContext)
	const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading")
	const description = alt?.trim() || "Image"
	if (!src) return <span className="agent-hud__image-unavailable">{description} — Image unavailable</span>

	if (status === "failed") {
		return (
			<span className="agent-hud__image-unavailable" role="status">
				{description} — Image unavailable{" "}
				{!linked ? <a className="agent-hud__markdown-link" href={src} target="_blank" rel="noreferrer">Open original</a> : null}
			</span>
		)
	}

	const preview = (
		<>
			{/* eslint-disable-next-line @next/next/no-img-element */}
			<img src={src} alt={description} loading="lazy" decoding="async" referrerPolicy="no-referrer"
				onLoad={() => setStatus("loaded")} onError={() => setStatus("failed")} />
			{status === "loading" ? <span className="agent-hud__image-loading">Loading image…</span> : null}
		</>
	)
	if (linked) return <span className="agent-hud__image-preview" aria-busy={status === "loading"}>{preview}</span>
	return (
		<button type="button" className="agent-hud__image-preview" aria-label={`Expand ${description}`}
			aria-haspopup="dialog" aria-busy={status === "loading"}
			onClick={(event) => {
				const image = event.currentTarget.querySelector("img")!
				// Reserve space before the full image reloads, so controls never jump.
				open({ src, description, trigger: event.currentTarget,
					width: image.naturalWidth || 720, height: image.naturalHeight || 480 })
			}}>
			{preview}
		</button>
	)
}
