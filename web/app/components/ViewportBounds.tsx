"use client"

import { useEffect } from "react"

/** Own viewport listeners for the lifetime of the persistent root layout. */
export function ViewportBounds() {
	useEffect(() => {
		const viewport = window.visualViewport
		const root = document.documentElement
		let frameId = 0
		const update = () => {
			if (frameId) return
			frameId = window.requestAnimationFrame(() => {
				frameId = 0
				// Pinch zoom should magnify the page, rather than shrink its layout.
				if (viewport && viewport.scale !== 1) return
				root.style.setProperty(
					"--landing-viewport-height", `${viewport?.height ?? window.innerHeight}px`,
				)
				root.style.setProperty(
					"--landing-viewport-top", `${viewport?.offsetTop ?? 0}px`,
				)
				root.style.setProperty(
					"--landing-viewport-width", `${viewport?.width ?? window.innerWidth}px`,
				)
				root.style.setProperty(
					"--landing-viewport-left", `${viewport?.offsetLeft ?? 0}px`,
				)
			})
		}
		update()
		window.addEventListener("resize", update)
		viewport?.addEventListener("resize", update)
		viewport?.addEventListener("scroll", update)
		return () => {
			window.removeEventListener("resize", update)
			viewport?.removeEventListener("resize", update)
			viewport?.removeEventListener("scroll", update)
			if (frameId) window.cancelAnimationFrame(frameId)
			root.style.removeProperty("--landing-viewport-height")
			root.style.removeProperty("--landing-viewport-top")
			root.style.removeProperty("--landing-viewport-width")
			root.style.removeProperty("--landing-viewport-left")
		}
	}, [])

	return null
}
