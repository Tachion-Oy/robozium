// The document theme; main saves it and matches the native window background.
import type { AppTheme } from "../../../src/bridge"
import { showNotificationToast } from "../feedback/notices"

export type { AppTheme }

export function applyTheme(theme: AppTheme): void {
	document.documentElement.dataset.theme = theme
	// The reference sets this inline; the renderer CSP permits only scripted styles.
	document.documentElement.style.colorScheme = theme
}

/** Switch the theme now, then save it; a failed save keeps the switch for this session. */
export async function toggleTheme(): Promise<void> {
	const theme: AppTheme = document.documentElement.dataset.theme === "light" ? "dark" : "light"
	applyTheme(theme)
	try {
		await window.robozium.setTheme(theme)
	} catch {
		showNotificationToast({ tone: "warning", title: "Theme not saved", message: "The theme applies until Robozium closes." })
	}
}
