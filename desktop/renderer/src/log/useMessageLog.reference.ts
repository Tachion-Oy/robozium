"use client"

import { useEffect, useRef, useState } from "react"
import { showErrorToast } from "@/app/components/feedback/ErrorToast"

/** Main-process state survives backend reloads without remounting the HUD. */
export function useMessageLog(desktop: boolean) {
	const [open, setOpen] = useState(false)
	const [pending, setPending] = useState(false)
	const revision = useRef(0)
	const busy = useRef(false)
	useEffect(() => {
		if (!desktop) return
		let cancelled = false
		const current = revision.current
		void window.robozium?.getMessageLog?.().then(state => {
			if (!cancelled && revision.current === current) setOpen(state.open)
		}).catch(cause => {
			if (!cancelled) showErrorToast({ title: "Could not open message log", message: cause instanceof Error ? cause.message : "Window operation failed" })
		})
		return () => { cancelled = true }
	}, [desktop])
	const toggle = async () => {
		if (busy.current) return
		busy.current = true
		revision.current++
		setPending(true)
		try {
			const state = await window.robozium!.setMessageLog(!open)
			setOpen(state.open)
		} catch (cause) {
			showErrorToast({ title: "Could not toggle message log", message: cause instanceof Error ? cause.message : "Window operation failed" })
		} finally {
			busy.current = false
			setPending(false)
		}
	}
	return { open, pending, toggle }
}
