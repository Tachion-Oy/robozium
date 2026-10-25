// Write the app icon from the Robozium mark: the HUD indicator's resting look, the
// mark in light blue on its dark round background with a blue glow. The .deb installs
// it as the scalable icon of the app's desktop entry. The mark is read from the same
// SVG the HUD draws, and tinted by its shape alone, so any single-colour SVG works.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const source = path.join(import.meta.dirname, "../renderer/public/branding/robozium-mark.svg")
const output = path.join(import.meta.dirname, "../dist/icon.svg")

// The dark theme's --term-blue, and its oklab mixes for the indicator's text and background.
const blue = "#40c8ff"
const markColor = "#74d4ff"
const background = "#072c3a"
// The mark's square box inside the 256-unit icon.
const markSize = 161

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
<feGaussianBlur in="mark" stdDeviation="6" result="blur"/><feFlood flood-color="${blue}" flood-opacity="0.85"/>
<feComposite in2="blur" operator="in"/><feMerge><feMergeNode/><feMergeNode in="mark"/></feMerge>
</filter></defs>
<circle r="122" fill="${background}" stroke="${blue}" stroke-opacity="0.5" stroke-width="4"/>
<g filter="url(#robozium-icon-glow)"><svg x="${-markSize / 2}" y="${-markSize / 2}" width="${markSize}" height="${markSize}" viewBox="${viewBox}">${content}</svg></g>
</svg>
`
mkdirSync(path.dirname(output), { recursive: true })
writeFileSync(output, icon)
