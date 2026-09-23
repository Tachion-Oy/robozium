"use client"

import { useEffect, useRef } from "react"
import {
	APP_THEME_CHANNEL_NAME,
	APP_THEME_COOKIE_NAME,
	type AppTheme,
} from "@/lib/theme"

const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

function readDocumentTheme(): AppTheme {
	return document.documentElement.dataset.theme === "light" ? "light" : "dark"
}

function applyTheme(theme: AppTheme) {
	document.documentElement.dataset.theme = theme
	document.documentElement.style.colorScheme = theme
}

function persistTheme(theme: AppTheme) {
	const secure = window.location.protocol === "https:" ? "; Secure" : ""
	document.cookie = `${APP_THEME_COOKIE_NAME}=${theme}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`
}

export function ThemeToggle() {
	const themeChannelRef = useRef<BroadcastChannel | null>(null)

	useEffect(() => {
		if (!("BroadcastChannel" in window)) return

		const themeChannel = new BroadcastChannel(APP_THEME_CHANNEL_NAME)
		themeChannelRef.current = themeChannel
		themeChannel.addEventListener("message", (event: MessageEvent<unknown>) => {
			if (event.data === "light" || event.data === "dark") {
				applyTheme(event.data)
			}
		})

		return () => {
			themeChannelRef.current = null
			themeChannel.close()
		}
	}, [])

	return (
		<button
			type="button"
			className="theme-toggle agent-hud__selector-trigger"
			data-hud-ignore-dismiss
			aria-label="Toggle color theme"
			onClick={() => {
				const nextTheme: AppTheme =
					readDocumentTheme() === "dark" ? "light" : "dark"
				applyTheme(nextTheme)
				try {
					persistTheme(nextTheme)
				} catch {
					// Theme still changes for this page when cookies are unavailable.
				}
				themeChannelRef.current?.postMessage(nextTheme)
			}}>
			<span className="theme-toggle__indicator" aria-hidden="true" />
			<span className="theme-toggle__label theme-toggle__label--light">
				Light
			</span>
			<span className="theme-toggle__label theme-toggle__label--dark">
				Dark
			</span>
		</button>
	)
}
