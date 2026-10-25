// Copied from web/app/components/hud/run/HudImage.tsx at 2a0c183.
// Adapted: hub images load from the backend, which requires the renderer's
// Origin. Remote images never load without a click: the CSP admits only the
// backend, and "Open original" opens either kind outside the window. The viewer
// outlives message changes and returns focus to the panel when its trigger is gone.
import { createContext, useContext, useEffect, useRef, useState, type MouseEvent, type ReactNode, type Ref, type RefObject } from "react"
import { resolveHudImageSource } from "../../links/hud-images"
import { openExternalLink, openHubFile } from "../../links/open-link"

type ResolvedImage = {
	src: string
	/** Agent output must not make the window fetch from other hosts. */
	remote: boolean
	openOriginal: () => void
}

type ImageSelection = ResolvedImage & {
	description: string
	trigger: HTMLElement
	width: number
	height: number
}

const ImageViewerContext = createContext<(image: ImageSelection) => void>(() => {})
/** The backend address of a hub file; without a provider, hub images are unavailable. */
export const HubFileUrlContext = createContext<((path: string) => string) | null>(null)
// Linked images must not place a button (or a fallback link) inside an anchor.
export const HudImageLinkContext = createContext(false)

/** `returnFocus` takes focus when the viewer closes after its trigger left the page. */
export function HudImageViewer({ returnFocus, children }: { returnFocus: RefObject<HTMLElement | null>; children: ReactNode }) {
	const [selection, setSelection] = useState<ImageSelection | null>(null)
	return (
		<ImageViewerContext value={setSelection}>
			{children}
			{selection ? <ImageDialog key={selection.src} image={selection} returnFocus={returnFocus} onClose={() => setSelection(null)} /> : null}
		</ImageViewerContext>
	)
}

function useResolvedImage(src: string | undefined): ResolvedImage | null {
	const hubFileUrl = useContext(HubFileUrlContext)
	const source = src ? resolveHudImageSource(src) : null
	if (source?.kind === "web") {
		return { src: source.url, remote: true, openOriginal: () => openExternalLink(source.url) }
	}
	if (source?.kind === "hub" && hubFileUrl) {
		return { src: hubFileUrl(source.path), remote: false, openOriginal: () => openHubFile(source.path) }
	}
	return null
}

/** The window never navigates; main opens the original outside it. */
function OriginalLink({ image, linkRef }: { image: ResolvedImage; linkRef?: Ref<HTMLAnchorElement> }) {
	const open = (event: MouseEvent<HTMLAnchorElement>) => {
		event.preventDefault()
		image.openOriginal()
	}
	return <a ref={linkRef} className="agent-hud__markdown-link" href={image.src} onClick={open}>Open original</a>
}

function ImageDialog({ image, returnFocus, onClose }: {
	image: ImageSelection
	returnFocus: RefObject<HTMLElement | null>
	onClose: () => void
}) {
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
			const target = image.trigger.isConnected ? image.trigger : returnFocus.current
			target?.focus({ preventScroll: true })
		}
	}, [image, returnFocus])

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
			}}
			onClick={(event) => {
				if (event.target !== event.currentTarget) return
				const bounds = event.currentTarget.getBoundingClientRect()
				if (event.clientX < bounds.left || event.clientX > bounds.right ||
					event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
			}}>
			<div className="agent-hud__image-toolbar">
				<span>{image.description}</span>
				<OriginalLink image={image} linkRef={originalRef} />
				<button ref={closeRef} type="button" onClick={onClose}>Close</button>
			</div>
			<div className="agent-hud__image-stage" style={{ width: image.width, aspectRatio: `${image.width} / ${image.height}` }}>
				{failed ? <p role="status">Image unavailable</p> : (
					<img src={image.src} crossOrigin="anonymous" alt={image.description} referrerPolicy="no-referrer" decoding="async" onError={() => setFailed(true)} />
				)}
			</div>
		</dialog>
	)
}

export function HudImage({ src, alt }: { src?: string; alt?: string }) {
	const open = useContext(ImageViewerContext)
	const linked = useContext(HudImageLinkContext)
	const image = useResolvedImage(src)
	const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading")
	const description = alt?.trim() || "Image"
	if (!image) return <span className="agent-hud__image-unavailable">{description} — Image unavailable</span>
	if (image.remote) {
		return (
			<span className="agent-hud__image-unavailable">
				{description} — Remote image{" "}
				{!linked ? <OriginalLink image={image} /> : null}
			</span>
		)
	}

	if (status === "failed") {
		return (
			<span className="agent-hud__image-unavailable" role="status">
				{description} — Image unavailable{" "}
				{!linked ? <OriginalLink image={image} /> : null}
			</span>
		)
	}

	const preview = (
		<>
			<img src={image.src} crossOrigin="anonymous" alt={description} loading="lazy" decoding="async" referrerPolicy="no-referrer"
				onLoad={() => setStatus("loaded")} onError={() => setStatus("failed")} />
			{status === "loading" ? <span className="agent-hud__image-loading">Loading image…</span> : null}
		</>
	)
	if (linked) return <span className="agent-hud__image-preview" aria-busy={status === "loading"}>{preview}</span>
	return (
		<button type="button" className="agent-hud__image-preview" aria-label={`Expand ${description}`}
			aria-haspopup="dialog" aria-busy={status === "loading"}
			onClick={(event) => {
				const element = event.currentTarget.querySelector("img")!
				// Reserve space before the full image reloads, so controls never jump.
				open({ ...image, description, trigger: event.currentTarget,
					width: element.naturalWidth || 720, height: element.naturalHeight || 480 })
			}}>
			{preview}
		</button>
	)
}
