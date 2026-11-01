// Write the app icon from the Robozium mark: the HUD indicator's waiting-for-reply look,
// the near-white mark and ring on its dark round background with a lime glow, a little softer
// than the indicator's. The .deb installs it as the scalable icon of the app's desktop
// entry. The mark is read from the same SVG the HUD draws, and tinted by its shape
// alone, so any single-colour SVG works.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"

const source = path.join(import.meta.dirname, "../renderer/public/branding/robozium-mark.svg")
// The README shows the same icon: `node desktop/scripts/build-icon.ts docs/assets/robozium-icon.svg`.
const output = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, "../dist/icon.svg"))

// The dark theme's --term-lime, and the oklab mixes of the awaiting-input indicator: its
// mark (84% white in lime), which also draws the ring, and its background (35% blue in black).
const lime = "#c2ff3a"
const markColor = "#f5ffe7"
const background = "#072c3a"
// The mark's square box: 81% of the circle, as in the HUD indicator.
const markSize = 198

const svg = readFileSync(source, "utf8").replace(/<\?xml[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<!--[\s\S]*?-->/g, "")
const root = /<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/.exec(svg.trim())
if (!root) throw new Error(`${source} has no <svg> root element.`)
const [, attributes, content] = root
const attribute = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`).exec(attributes)?.[1]
const size = (name: string) => attribute(name)?.match(/^[\d.]+/)?.[0]
const viewBox = attribute("viewBox") ?? (size("width") && size("height") ? `0 0 ${size("width")} ${size("height")}` : undefined)
if (!viewBox) throw new Error(`${source} needs a viewBox, or a width and height.`)
// Editors prefix their own elements and attributes; their namespaces move to the icon's root.
const namespaces = [...new Set(attributes.match(/\sxmlns:[\w-]+\s*=\s*["'][^"']*["']/g) ?? [])].join("")

const icon = `<svg xmlns="http://www.w3.org/2000/svg"${namespaces} viewBox="-128 -128 256 256">
<defs><filter id="robozium-icon-glow" x="-50%" y="-50%" width="200%" height="200%">
<feFlood flood-color="${markColor}"/><feComposite in2="SourceAlpha" operator="in" result="mark"/>
<feGaussianBlur in="mark" stdDeviation="2" result="near"/><feFlood flood-color="white" flood-opacity="0.45"/>
<feComposite in2="near" operator="in" result="sheen"/>
<feGaussianBlur in="mark" stdDeviation="7" result="far"/><feFlood flood-color="${lime}" flood-opacity="0.6"/>
<feComposite in2="far" operator="in" result="glow"/>
<feMerge><feMergeNode in="glow"/><feMergeNode in="sheen"/><feMergeNode in="mark"/></feMerge>
</filter></defs>
<circle r="122" fill="${background}" stroke="${markColor}" stroke-opacity="0.5" stroke-width="4"/>
<g filter="url(#robozium-icon-glow)"><svg x="${-markSize / 2}" y="${-markSize / 2}" width="${markSize}" height="${markSize}" viewBox="${viewBox}">${content}</svg></g>
</svg>
`
mkdirSync(path.dirname(output), { recursive: true })
writeFileSync(output, icon)
