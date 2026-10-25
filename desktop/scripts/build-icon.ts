// Write the app icon from the Robozium mark: the HUD indicator's resting look, the
// mark in light blue on its dark round background with a blue glow. The .deb installs
// it as the scalable icon of the app's desktop entry.
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { markPath } from "../renderer/src/ui/branding/robozium-mark.ts"

// The dark theme's --term-blue, and its oklab mixes for the indicator's text and background.
const blue = "#40c8ff"
const markColor = "#74d4ff"
const background = "#072c3a"

const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-128 -128 256 256">
<defs><filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
<feGaussianBlur stdDeviation="6" result="blur"/><feFlood flood-color="${blue}" flood-opacity="0.85"/>
<feComposite in2="blur" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
</filter></defs>
<circle r="122" fill="${background}" stroke="${blue}" stroke-opacity="0.5" stroke-width="4"/>
<path transform="scale(0.72)" fill="${markColor}" filter="url(#glow)" d="${markPath}"/>
</svg>
`
const output = path.join(import.meta.dirname, "../dist/icon.svg")
mkdirSync(path.dirname(output), { recursive: true })
writeFileSync(output, icon)
