// Copied from robozium-electron/desktop/electron/message-log-window.cjs at 076b2c9.
// Adapted: TypeScript, the log is added beside the HUD instead of taking part of
// its width, and the pane minima are named so tests can match them against the
// desktop.css layout.
import { windowLimits, type Size, type WorkArea } from "./window.ts"

/** CSS pixel minima of the log layouts in desktop.css: HUD + log side by side, or stacked. */
export const HUD_MIN_WIDTH = 640
export const LOG_MIN_WIDTH = 480
export const LOG_SIDE_WIDTH = HUD_MIN_WIDTH + LOG_MIN_WIDTH
export const LOG_STACK_HEIGHT = 336 + 224

/**
 * The window that adds the log beside a HUD of `size`. The log takes its 2fr
 * share of the 3fr:2fr panes, so the HUD keeps its width; CSS pixel minima
 * scale with zoom.
 */
export function logWindowSize(size: Size, maximum: Size, zoom: number): Size {
	const side = Math.ceil(LOG_SIDE_WIDTH * zoom)
	if (maximum.width >= side) {
		const log = Math.max(Math.ceil(size.width * 2 / 3), Math.ceil(LOG_MIN_WIDTH * zoom))
		return { width: Math.max(size.width + log, side), height: size.height }
	}
	return { width: size.width, height: Math.min(maximum.height, Math.max(size.height, Math.ceil(LOG_STACK_HEIGHT * zoom))) }
}

/** The HUD's column in a window of `width` with the log open: what closing the log leaves. */
export function hudWidth(width: number, zoom: number): number {
	if (width < Math.ceil(LOG_SIDE_WIDTH * zoom)) return width
	return Math.max(Math.ceil(HUD_MIN_WIDTH * zoom), Math.min(Math.round(width * 3 / 5), width - Math.ceil(LOG_MIN_WIDTH * zoom)))
}

interface Bounds extends Size { x: number; y: number }

/** The parts of a BrowserWindow this class uses, so tests can supply a fake. */
export interface LogWindowTarget {
	getBounds(): Bounds
	getContentBounds(): Bounds
	getContentSize(): number[]
	setContentSize(width: number, height: number): void
	setPosition(x: number, y: number): void
	webContents: { getZoomFactor(): number }
}

type DisplayLookup = (bounds: Bounds) => { workArea: WorkArea & { x: number; y: number } }

/** Own temporary native expansion independently of document reloads. */
export class MessageLogWindow {
	open = false
	manuallyResized = false
	private baseline: Size | null = null
	private applying = false
	private expected: Size | null = null
	private readonly window: LogWindowTarget
	private readonly display: DisplayLookup

	constructor(window: LogWindowTarget, display: DisplayLookup) {
		this.window = window
		this.display = display
	}

	private maximum(): Size {
		const bounds = this.window.getBounds()
		const content = this.window.getContentBounds()
		const limits = windowLimits(this.display(bounds).workArea)
		return { width: limits.maxWidth - (bounds.width - content.width), height: limits.maxHeight - (bounds.height - content.height) }
	}

	private apply(size: Size): void {
		const maximum = this.maximum()
		this.expected = { width: Math.min(size.width, maximum.width), height: Math.min(size.height, maximum.height) }
		this.applying = true
		try {
			this.window.setContentSize(this.expected.width, this.expected.height)
			const bounds = this.window.getBounds()
			const area = this.display(bounds).workArea
			const x = Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width))
			const y = Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height))
			if (x !== bounds.x || y !== bounds.y) this.window.setPosition(x, y)
		} finally { this.applying = false }
	}

	private contentSize(): Size {
		const [width, height] = this.window.getContentSize()
		return { width, height }
	}

	/** The window without the log: its size before opening, or the HUD's column of a size the user chose. */
	private closedSize(): Size {
		if (!this.manuallyResized && this.baseline) return this.baseline
		const { width, height } = this.contentSize()
		return { width: hudWidth(width, this.window.webContents.getZoomFactor()), height }
	}

	/** Add the log beside the HUD; a zoom change recomputes it. */
	expand(): void {
		const current = this.contentSize()
		const size = logWindowSize(this.closedSize(), this.maximum(), this.window.webContents.getZoomFactor())
		if (current.width !== size.width || current.height !== size.height) this.apply(size)
	}

	setOpen(open: unknown): { open: boolean } {
		if (typeof open !== "boolean") throw new Error("Invalid message log state.")
		if (open === this.open) return { open }
		if (open) {
			this.baseline = this.contentSize()
			this.expected = this.baseline
			this.manuallyResized = false
			this.open = true
			this.expand()
		} else {
			// Closing detaches the log: the HUD keeps its width.
			this.apply(this.closedSize())
			this.open = false
			this.baseline = null
		}
		return { open: this.open }
	}

	resized(): void {
		if (!this.open || this.applying) return
		const { width, height } = this.contentSize()
		if (width !== this.expected?.width || height !== this.expected?.height) this.manuallyResized = true
	}

	/** The size to remember: the window without the log. */
	savedSize(): Size {
		return this.open ? this.closedSize() : this.contentSize()
	}
}
