import { useEffect, useRef, type ReactElement } from "react"
import { dismiss, pause, resume, useNotices } from "../../feedback/notices"
import { ErrorToastContent } from "./ErrorToast"

/** The reference top-centre stack, using stylesheet classes under the renderer CSP. */
export function ToastViewport(): ReactElement {
	const notices = useNotices()
	const viewport = useRef<HTMLDivElement>(null)
	const previousFocus = useRef<HTMLElement | null>(null)
	// A toast removed under a still pointer never reports leaving; the next hover elsewhere resumes.
	useEffect(() => {
		const hoverElsewhere = (event: MouseEvent) => {
			if (!(event.target instanceof Node && viewport.current?.contains(event.target))) resume()
		}
		document.addEventListener("mouseover", hoverElsewhere)
		return () => document.removeEventListener("mouseover", hoverElsewhere)
	}, [])
	// Return to the element focused before the toasts, or else to another toast's Dismiss.
	const restoreFocus = (id: number) => {
		const previous = previousFocus.current
		if (previous?.isConnected) return previous.focus()
		const next = notices.findIndex(notice => notice.id !== id && notice.visible)
		viewport.current?.children[next]?.querySelector("button")?.focus()
	}
	return (
		// Above the startup screen (z-index 10000), whose failures are toasts too.
		<div ref={viewport} role="region" aria-label="Notifications"
			className="pointer-events-none fixed inset-x-0 top-4 z-[10001] flex flex-col items-center gap-2"
			onMouseEnter={pause} onMouseLeave={resume}
			// Pointer dismissal keeps the editor focused; keyboard dismissal restores it.
			onMouseDown={event => {
				if (event.target instanceof Element && event.target.closest("button")) event.preventDefault()
			}}
			onFocusCapture={event => {
				if (!event.currentTarget.contains(event.relatedTarget)) previousFocus.current = event.relatedTarget as HTMLElement | null
			}}>
			{notices.map(notice => <ErrorToastContent key={notice.id} {...notice}
				isVisible={notice.visible} onDismiss={() => {
					if (viewport.current?.contains(document.activeElement)) restoreFocus(notice.id)
					dismiss(notice.id)
				}} />)}
		</div>
	)
}
