import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { BackendStartup } from "./backend/BackendStartup"
import { ViewportBounds } from "./app/ViewportBounds"
import { applyTheme } from "../theme/theme"
import "./styles/globals.css"

const root = document.getElementById("root")
if (!root) throw new Error("The application root element is missing.")
// Apply the saved theme before the first render. The window stays hidden until the
// intro has painted in its own fonts rather than fallbacks.
applyTheme(window.robozium.theme)
async function loadFont(face: FontFace): Promise<void> {
	try {
		await face.load()
	} catch (error) {
		console.error(`The ${face.family} font could not load:`, error)
	}
}

async function start(element: HTMLElement): Promise<void> {
	await Promise.all(Array.from(document.fonts, loadFont))
	flushSync(() => createRoot(element).render(<>
		<ViewportBounds />
		<BackendStartup />
	</>))
	// A hidden window may draw no frames, so lay the render out at once. That requests the
	// fonts it uses: Chromium may have replaced the faces loaded above, but their files are cached.
	document.body.getBoundingClientRect()
	await document.fonts.ready
	// The first frame drawn after the window shows is the intro in its own fonts.
	await window.robozium.painted()
}

void start(root)
