// Adapted from robozium-electron/desktop/web/hooks/useMessageLog.ts at 076b2c9.
// Main owns whether the message log is open, because opening it grows the window
// and closing it restores the earlier size; the state survives renderer reloads.
import { useCallback, useEffect, useRef, useState } from "react"
import { showErrorToast } from "../feedback/notices"

export interface MessageLogState {
	open: boolean
	/** A window resize is in progress; the toggle waits for it. */
	pending: boolean
	toggle: () => void
}

function failureDetail(cause: unknown): string {
	return cause instanceof Error ? cause.message : "Window operation failed"
}

export function useMessageLog(): MessageLogState {
	const [open, setOpen] = useState(false)
	const [pending, setPending] = useState(false)
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

	const toggle = useCallback(() => {
		if (busy.current) return
		busy.current = true
		revision.current++
		setPending(true)
		const change = async () => {
			try {
				const state = await window.robozium.setMessageLog(!open)
				setOpen(state.open)
			} catch (cause) {
				showErrorToast({ title: "Could not toggle message log", message: failureDetail(cause) })
			} finally {
				busy.current = false
				setPending(false)
			}
		}
		void change()
	}, [open])

	return { open, pending, toggle }
}
