// Window size limits, the startup size and zoom. The zoom shortcut uses the
// platform's own modifier (Command on macOS, Control elsewhere).

export interface Size { width: number; height: number }
export interface WorkArea { width: number; height: number }
export interface WindowLimits { minWidth: number; minHeight: number; maxWidth: number; maxHeight: number }
export interface ZoomInput {
	type: string
	key: string
	code: string
	control: boolean
	meta: boolean
	alt: boolean
	isComposing: boolean
}

export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 3

export function windowLimits(workArea: WorkArea): WindowLimits {
	const maxWidth = Math.floor(workArea.width * 0.9)
	const maxHeight = Math.floor(workArea.height * 0.9)
	return { minWidth: Math.min(640, maxWidth), minHeight: Math.min(420, maxHeight), maxWidth, maxHeight }
}

export function boundedSize(size: Size, limits: WindowLimits): Size {
	if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) throw new Error("Invalid window size.")
	return {
		width: Math.round(Math.min(limits.maxWidth, Math.max(limits.minWidth, size.width))),
		height: Math.round(Math.min(limits.maxHeight, Math.max(limits.minHeight, size.height))),
	}
}

/**
 * Every start opens at this content size, shrunk to fit a small work area; the size is never
 * remembered. It is fixed, not a share of the screen, because Wayland may report the screen in
 * physical pixels: on GNOME at 200% without fractional scaling a share would cover the screen.
 */
const STARTUP_SIZE: Size = { width: 1080, height: 720 }

export function startupSize(workArea: WorkArea): Size {
	return boundedSize(STARTUP_SIZE, windowLimits(workArea))
}

/** 1 zooms in, -1 out, 0 resets; null leaves the input to the page. */
export function zoomShortcut(input: ZoomInput, platform: NodeJS.Platform): 1 | -1 | 0 | null {
	const modifier = platform === "darwin" ? input.meta && !input.control : input.control && !input.meta
	if (input.type !== "keyDown" || !modifier || input.alt || input.isComposing) return null
	if (["+", "="].includes(input.key) || input.code === "NumpadAdd") return 1
	if (input.key === "-" || input.code === "NumpadSubtract") return -1
	if (input.key === "0" || input.code === "Numpad0") return 0
	return null
}

export function nextZoom(current: number, direction: 1 | -1 | 0): number {
	if (direction === 0) return 1
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((current + direction * 0.1) * 10) / 10))
}
