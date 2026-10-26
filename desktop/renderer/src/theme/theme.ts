// The document theme; main saves it and matches the native window background.
import type { AppTheme } from "../../../src/bridge"
import { showNotificationToast } from "../feedback/notices"

export type { AppTheme }

export function applyTheme(theme: AppTheme): void {
	document.documentElement.dataset.theme = theme
	// The reference sets this inline; the renderer CSP permits only scripted styles.
	document.documentElement.style.colorScheme = theme
}

/** The latest switch's fade; a newer switch keeps the mark until its own fade ends. */
let switching: ViewTransition | null = null

/**
 * Switch the theme now, then save it; a failed save keeps the switch for this session.
 * The window fades through the new theme's background (theme-toggle.css): the old
 * view stays frozen while the new theme lays out, so nothing jumps between spacings.
 */
export async function toggleTheme(): Promise<void> {
	const theme: AppTheme = document.documentElement.dataset.theme === "light" ? "dark" : "light"
	if (matchMedia("(prefers-reduced-motion: reduce)").matches) applyTheme(theme)
	else {
		// Marks the fade until it ends, for anything that must wait for the settled view.
		const root = document.documentElement
		const transition = document.startViewTransition(() => applyTheme(theme))
		switching = transition
		root.dataset.themeSwitching = ""
		void transition.finished.finally(() => { if (switching === transition) delete root.dataset.themeSwitching })
		await transition.updateCallbackDone
	}
	try {
		await window.robozium.setTheme(theme)
	} catch {
		showNotificationToast({ tone: "warning", title: "Theme not saved", message: "The theme applies until Robozium closes." })
	}
}
