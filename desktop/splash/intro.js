// Same choreography as the reference IntroStream: 160 chars/s, 85 ms between
// rows, alternating directions, then a 1600 ms pause. Full layout exists first.
export const surface = /** @type {HTMLElement} */ (document.querySelector(".startup"))
export const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
export let introDone = false
let introFrame = 0
let pauseTimer = 0
const rows = [...document.querySelectorAll("[data-intro-row]")].map(row => {
	const targets = row.querySelectorAll(".term-msg-content, .term-banner-val")
	/** @type {HTMLElement[]} */
	const characters = []
	for (const target of targets) {
		const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT)
		/** @type {Node[]} */
		const nodes = []
		while (walker.nextNode()) nodes.push(walker.currentNode)
		for (const node of nodes) {
			const fragment = document.createDocumentFragment()
			for (const character of node.textContent ?? "") {
				const span = document.createElement("span")
				span.className = "intro-character"
				span.textContent = character
				characters.push(span)
				fragment.append(span)
			}
			node.parentNode?.replaceChild(fragment, node)
		}
	}
	return { element: row, characters, shown: 0 }
})

export function finishIntro() {
	if (introDone) return
	window.cancelAnimationFrame(introFrame)
	window.clearTimeout(pauseTimer)
	for (const row of rows) {
		for (const character of row.characters) character.classList.add("intro-character--shown")
		row.element.classList.add("intro-settled")
	}
	introDone = true
	surface.dataset.stage = "loading"
}

async function playIntro() {
	await document.fonts.ready
	if (introDone) return
	if (motion.matches) { finishIntro(); return }
	const start = performance.now()
	/** @param {number} now */
	const frame = now => {
		let complete = true
		rows.forEach((row, index) => {
			const count = Math.min(row.characters.length, Math.max(0, Math.floor((now - start - index * 85) * 160 / 1000)))
			while (row.shown < count) {
				const offset = index % 2 ? row.characters.length - 1 - row.shown : row.shown
				row.characters[offset].classList.add("intro-character--shown")
				row.shown++
			}
			if (row.shown === row.characters.length) row.element.classList.add("intro-settled")
			else complete = false
		})
		if (complete) pauseTimer = window.setTimeout(finishIntro, 1600)
		else introFrame = window.requestAnimationFrame(frame)
	}
	introFrame = window.requestAnimationFrame(frame)
}
motion.addEventListener("change", () => { if (motion.matches) finishIntro() })
void playIntro()
