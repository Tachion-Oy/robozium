// One pixel of the screen as a CSS length, kept on <html> as --screen-row. The dark
// theme draws its scan lines in whole screen rows (theme.css), so they stay even at
// every zoom instead of falling between pixels.

/** The zoom at which one pixel is a row; a screen twice as dense gets two pixels to the row. */
const ROW_ZOOM = 1.4

function writeScreenRow(): void {
	const ratio = window.devicePixelRatio
	const pixels = Math.max(1, Math.round(ratio / ROW_ZOOM))
	document.documentElement.style.setProperty("--screen-row", `${pixels / ratio}px`)
}

/** Set --screen-row now and keep it current: a zoom or screen change resizes the page. */
export function trackScreenRow(): void {
	writeScreenRow()
	window.addEventListener("resize", writeScreenRow)
}
