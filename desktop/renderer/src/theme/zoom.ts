// The app's zoom as a number, kept on <html> as --zoom. The light theme divides the
// width of its stripes and scan lines by it (light-theme.css), so they are as wide
// on the screen at every zoom instead of growing with the page.

async function writeZoom(): Promise<void> {
	try {
		const zoom = await window.robozium.getZoom()
		document.documentElement.style.setProperty("--zoom", String(zoom.factor))
	} catch {
		// The stripes keep the last zoom read; at the start, 100%.
	}
}

/** Set --zoom now and keep it current: a zoom change resizes the page. */
export function trackZoom(): void {
	void writeZoom()
	window.addEventListener("resize", () => {
		void writeZoom()
	})
}
