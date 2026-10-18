import { surface, introDone, finishIntro } from "./intro.js"

const message = /** @type {HTMLParagraphElement} */ (document.getElementById("status"))
const retry = /** @type {HTMLButtonElement} */ (document.getElementById("retry"))

async function update() {
	try {
		const status = await window.roboziumStartup.status()
		surface.dataset.failed = String(status.failed)
		// Keep the splash steady while a step runs; announce only changes.
		if (message.textContent !== status.message) message.textContent = status.message
		message.setAttribute("role", status.failed ? "alert" : "status")
		retry.hidden = !status.retry
		if (status.failed) finishIntro()
		if (status.ready && introDone) {
			surface.dataset.stage = "handoff"
			await Promise.allSettled(surface.getAnimations().map(animation => animation.finished))
			await window.roboziumStartup.finished()
			return
		}
		window.setTimeout(update, 200)
	} catch {
		message.textContent = "Could not read startup progress. Close and reopen Robozium."
		message.setAttribute("role", "alert")
		retry.hidden = true
	}
}
retry.addEventListener("click", async () => {
	retry.disabled = true
	try { await window.roboziumStartup.retry() }
	catch {
		message.textContent = "Could not retry startup. Close and reopen Robozium."
		message.setAttribute("role", "alert")
	}
	finally { retry.disabled = false }
})
void update()
