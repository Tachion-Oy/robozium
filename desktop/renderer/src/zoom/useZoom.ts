// Main owns the zoom: the shortcuts and the edge buttons step it the same way, and
// every start opens at 100%. A zoom change resizes the CSS viewport, so the window's
// resize event re-reads which way the zoom can still move.
import { useCallback, useEffect, useState } from "react"
import type { ZoomState } from "../../../src/bridge"
import { showErrorToast } from "../feedback/notices"

export interface Zoom extends ZoomState {
	step: (direction: 1 | -1) => void
}

function failureDetail(cause: unknown): string {
	return cause instanceof Error ? cause.message : "Window operation failed"
}

export function useZoom(): Zoom {
	const [state, setState] = useState<ZoomState>({ canZoomIn: true, canZoomOut: true })

	useEffect(() => {
		let cancelled = false
		const read = async () => {
			try {
				const next = await window.robozium.getZoom()
				if (!cancelled) setState(next)
			} catch {
				// The buttons stay usable; a step reports its own failure.
			}
		}
		const onResize = () => { void read() }
		void read()
		window.addEventListener("resize", onResize)
		return () => {
			cancelled = true
			window.removeEventListener("resize", onResize)
		}
	}, [])

	const step = useCallback((direction: 1 | -1) => {
		const change = async () => {
			try {
				setState(await window.robozium.zoom(direction))
			} catch (cause) {
				showErrorToast({ title: "Could not zoom", message: failureDetail(cause) })
			}
		}
		void change()
	}, [])

	return { ...state, step }
}
