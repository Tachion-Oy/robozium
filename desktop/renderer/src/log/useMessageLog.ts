// Adapted from robozium-electron/desktop/web/hooks/useMessageLog.ts at 076b2c9.
// Main owns whether the message log is open, because opening it grows the window
// and closing it restores the earlier size; the state survives renderer reloads.
// Adapted: the HUD keeps its width while the window resizes, and closing hides the
// log before the window shrinks.
import { useCallback, useEffect, useRef, useState } from "react"
import { showErrorToast } from "../feedback/notices"

export interface MessageLogState {
	open: boolean
	/** The HUD's CSS pixel width, held while a window resize is in progress; the toggle waits for it. */
	resizingWidth: number | null
	/** Toggle with the HUD's current width, which it keeps while the window resizes. */
	toggle: (hudWidth: number) => void
}

function failureDetail(cause: unknown): string {
	return cause instanceof Error ? cause.message : "Window operation failed"
}

export function useMessageLog(): MessageLogState {
	const [open, setOpen] = useState(false)
	const [resizingWidth, setResizingWidth] = useState<number | null>(null)
	// A toggle started before the initial read finishes wins over that read.
	const revision = useRef(0)
	const busy = useRef(false)

	useEffect(() => {
		let cancelled = false
		const current = revision.current
		const read = async () => {
			try {
				const state = await window.robozium.getMessageLog()
				if (!cancelled && revision.current === current) setOpen(state.open)
			} catch (cause) {
				if (!cancelled) showErrorToast({ title: "Could not open message log", message: failureDetail(cause) })
			}
		}
		void read()
		return () => { cancelled = true }
	}, [])

	const toggle = useCallback((hudWidth: number) => {
		if (busy.current) return
		busy.current = true
		revision.current++
		setResizingWidth(hudWidth)
		const change = async () => {
			try {
				// Closing shrinks the window: hide the log and let that frame paint first, or
				// the narrower window briefly docks the still-open log below the HUD.
				if (open) {
					setOpen(false)
					await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
				}
				const state = await window.robozium.setMessageLog(!open)
				setOpen(state.open)
			} catch (cause) {
				setOpen(open)
				showErrorToast({ title: "Could not toggle message log", message: failureDetail(cause) })
			} finally {
				busy.current = false
				setResizingWidth(null)
			}
		}
		void change()
	}, [open])

	return { open, resizingWidth, toggle }
}
