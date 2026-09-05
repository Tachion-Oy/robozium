"use client"

import { useEffect } from "react"

/** Close an open run HUD only when the user presses Escape. */
export function useHudEscapeDismiss(
	onDismiss: () => void,
	enabled: boolean,
) {
	useEffect(() => {
		if (!enabled) return

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onDismiss()
		}

		document.addEventListener("keydown", onKeyDown)
		return () => {
			document.removeEventListener("keydown", onKeyDown)
		}
	}, [onDismiss, enabled])
}
