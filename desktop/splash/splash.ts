// The bootstrap strips this file's types when it serves it, so it needs no build.
export {}

interface Preparation { step: string; failure: string | null }

const statusText = document.getElementById("status") as HTMLParagraphElement
const failureBox = document.querySelector(".splash__failure") as HTMLDivElement
const failure = document.getElementById("failure") as HTMLParagraphElement
const retry = document.getElementById("retry") as HTMLButtonElement

async function update(): Promise<void> {
	try {
		const response = await fetch("status", { cache: "no-store" })
		const preparation = await response.json() as Preparation
		// Announce only changes.
		if (statusText.textContent !== preparation.step) statusText.textContent = preparation.step
		failureBox.hidden = preparation.failure === null
		if (failure.textContent !== preparation.failure) failure.textContent = preparation.failure
	} catch { /* The app replaces this page once preparation ends. */ }
	setTimeout(update, 200)
}
retry.addEventListener("click", async () => {
	retry.disabled = true
	try { await fetch("retry", { method: "POST" }) }
	finally { retry.disabled = false }
})
void update()
